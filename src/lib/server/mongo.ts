import { env } from '$env/dynamic/private';
import { MongoClient, type Db } from 'mongodb';

const DATABASE_NAME = env.MONGODB_DB || 'watching_analytics';
let clientPromise: Promise<MongoClient> | undefined;

export function isMongoConfigured(): boolean {
	return !!env.MONGODB;
}

async function mongoClient(): Promise<MongoClient> {
	if (!env.MONGODB) throw new Error('MONGODB is not configured.');
	if (!clientPromise) {
		const client = new MongoClient(env.MONGODB, {
			appName: 'watching',
			ignoreUndefined: true,
			maxPoolSize: 5,
			minPoolSize: 0,
			maxIdleTimeMS: 30_000,
			serverSelectionTimeoutMS: 3_000,
			connectTimeoutMS: 3_000
		});
		clientPromise = client.connect().catch((error) => {
			clientPromise = undefined;
			throw error;
		});
	}
	return clientPromise;
}

export async function mongoDb(): Promise<Db> {
	return (await mongoClient()).db(DATABASE_NAME);
}
