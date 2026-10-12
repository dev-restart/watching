import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { chooseLocale, currentLocale, dictionaries, healthCopy, HEALTH_COPY, INSTALL_COPY,
  LANGUAGE_OPTIONS, LANGUAGE_STORAGE_KEY, locale, LOCALE_TAGS, parseLocale, restoreLocale, translate } from '../src/lib/i18n.ts';

const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
  else Reflect.deleteProperty(globalThis, 'document');
  if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  // Reset in-memory state without modifying any restored host storage.
  locale.set('en');
});

test('flags, names and strict four-language allowlist', () => {
  assert.deepEqual(LANGUAGE_OPTIONS.map(x => x.value), ['en', 'ko', 'es', 'ru']);
  assert.deepEqual(LANGUAGE_OPTIONS.map(x => x.flag), ['🇺🇸', '🇰🇷', '🇪🇸', '🇷🇺']);
  assert.equal(LANGUAGE_OPTIONS.find(x => x.value === 'ru')?.name, 'Русский');
  for (const { value } of LANGUAGE_OPTIONS) assert.equal(parseLocale(value), value);
  for (const input of ['fr', 'de', 'ko-KR', 'ru-RU', 'RU', null, {}, '']) assert.equal(parseLocale(input), null);
});

test('each language choice persists on the device and restores html lang after a fresh app state', () => {
  const data = new Map<string, string>();
  const localStorage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const document = { documentElement: { lang: 'en' } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorage });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  for (const { value } of LANGUAGE_OPTIONS) {
    chooseLocale(value);
    assert.equal(data.get(LANGUAGE_STORAGE_KEY), value);
    assert.equal(document.documentElement.lang, value);
    locale.set('en'); // Simulate startup without overwriting the saved preference.
    document.documentElement.lang = 'en';
    restoreLocale();
    assert.equal(currentLocale(), value);
    assert.equal(document.documentElement.lang, value);
  }
});

test('translation changes instantly and falls back for source titles', () => {
  assert.equal(translate('en', 'Bookmarks'), 'Bookmarks');
  assert.equal(translate('ko', 'Bookmarks'), '즐겨찾기');
  assert.equal(translate('es', 'Bookmarks'), 'Favoritos');
  assert.equal(translate('ru', 'Bookmarks'), 'Избранное');
  assert.equal(translate('es', 'What do you want to watch?'), '¿Qué quieres ver?');
  assert.equal(translate('ru', 'What do you want to watch?'), 'Что хотите посмотреть?');
  for (const { value } of LANGUAGE_OPTIONS) {
    assert.equal(translate(value, 'User-supplied movie title'), 'User-supplied movie title');
    assert.equal(translate(value, '사용자 영상 제목'), '사용자 영상 제목');
  }
  assert.equal(healthCopy('ko', 'maintenance')[0], '현재 서버 점검 중입니다');
  assert.equal(healthCopy('es', 'unavailable')[0], 'No se puede conectar al servidor de video');
  assert.equal(healthCopy('ru', 'maintenance')[0], 'Техническое обслуживание сервера');
});

test('blocked storage does not break Russian selection or the English startup fallback', () => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem() { throw Error('Denied'); }, setItem() { throw Error('Denied'); }
  } });
  assert.doesNotThrow(() => chooseLocale('ru'));
  assert.equal(currentLocale(), 'ru');
  assert.doesNotThrow(() => restoreLocale());
  assert.equal(currentLocale(), 'en');
});

test('Russian covers every existing translation key without empty or English fallback entries', () => {
  const expectedKeys = [...new Set([...Object.keys(dictionaries.ko), ...Object.keys(dictionaries.es)])].sort();
  assert.deepEqual(Object.keys(dictionaries.ru).sort(), expectedKeys);
  for (const key of expectedKeys) {
    const translated = translate('ru', key);
    assert.ok(translated.trim(), key);
    assert.notEqual(translated, key, key);
    assert.match(translated, /[А-Яа-яЁё]/u, key);
  }
});

test('all health states and platform installation guides have Russian translations', () => {
  for (const state of Object.keys(HEALTH_COPY) as Array<keyof typeof HEALTH_COPY>) {
    for (const text of healthCopy('ru', state)) assert.match(text, /[А-Яа-яЁё]/u);
  }
  for (const guide of Object.values(INSTALL_COPY)) {
    assert.notEqual(translate('ru', guide), guide);
    assert.match(translate('ru', guide), /[А-Яа-яЁё]/u);
  }
});

test('Russian status timestamps use ru-RU rather than the English default', () => {
  assert.equal(LOCALE_TAGS.ru, 'ru-RU');
  assert.equal(new Intl.DateTimeFormat(LOCALE_TAGS.ru).resolvedOptions().locale, 'ru-RU');
  assert.deepEqual(LOCALE_TAGS, { en: 'en-US', ko: 'ko-KR', es: 'es-ES', ru: 'ru-RU' });
});

test('invalid stored language falls back safely while Russian is restored unchanged', () => {
  let stored: string | null = 'invalid';
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; }
  } });
  restoreLocale();
  assert.equal(currentLocale(), 'en');
  stored = 'ru';
  restoreLocale();
  assert.equal(currentLocale(), 'ru');
  assert.equal(stored, 'ru');
});
