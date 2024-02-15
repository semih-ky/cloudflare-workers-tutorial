/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	// Example binding to KV. Learn more at https://developers.cloudflare.com/workers/runtime-apis/kv/
	// MY_KV_NAMESPACE: KVNamespace;
	//
	// Example binding to Durable Object. Learn more at https://developers.cloudflare.com/workers/runtime-apis/durable-objects/
	// MY_DURABLE_OBJECT: DurableObjectNamespace;
	//
	// Example binding to R2. Learn more at https://developers.cloudflare.com/workers/runtime-apis/r2/
	// MY_BUCKET: R2Bucket;
	//
	// Example binding to a Service. Learn more at https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
	// MY_SERVICE: Fetcher;
	//
	// Example binding to a Queue. Learn more at https://developers.cloudflare.com/queues/javascript-apis/
	// MY_QUEUE: Queue;
}


type UserInfo = {
	[key: string]: {
		time: number;
		group: number;
		count: number;
		visit: number;
		remainReq: number;
		requestTime: number;
		firstRequestTime: number;
		rateLeft: number;
	}
}

const MAX_REQUESTS_PER_MIN = 4;
const RATE_LIMIT_SEC = 60; // 1 min

let userInfoDB: UserInfo = {};

const hashId = (userId: string) => (+userId % 100) + 1;

const sleep = (time: number) => new Promise((res, _) => setTimeout(() => res(""), time * 1000))

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

		const authHeader = request.headers.get('Authorization');
		const token = authHeader?.split(" ")?.[1];
		const userIdMatch = /^USER(\d{3})$/.exec(token || "");
		if (!userIdMatch) {
			return new Response(JSON.stringify({message: 'Unauthorized'}), { status: 401 });
		}

		const userId = userIdMatch[1];
		const group = hashId(userId);
		const nowTimeEpoch = Math.floor(new Date().getTime()/1000.0);
		
		let userInfo = userInfoDB[userId] || {
			count: 0,
			visit: 0,
			requestTime: 0,
			firstRequestTime: nowTimeEpoch
		}

	
		if (userInfo.count >= MAX_REQUESTS_PER_MIN && nowTimeEpoch - userInfo.requestTime < RATE_LIMIT_SEC) {
			return new Response(JSON.stringify({ message: 'Rate Limit Exceeded' }), { status: 429 });
		}

		if (nowTimeEpoch - userInfo.firstRequestTime > RATE_LIMIT_SEC) {
			userInfo.count = 0;
			userInfo.firstRequestTime = nowTimeEpoch;
		}

		userInfo.count += 1;
		userInfo.visit += 1;
		userInfo.requestTime = nowTimeEpoch;
		userInfo.rateLeft = Math.max(0, MAX_REQUESTS_PER_MIN - userInfo.count)
		userInfoDB[userId] = userInfo;

		const streamParam = new URL(request.url).searchParams.get('stream');
		const isStream = streamParam === 'true';

		if (isStream) {
			const response = {
				headers: new Headers({
				  'Content-Type': 'text/event-stream',
				  'Cache-Control': 'no-cache',
				  'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept',
				  Connection: 'keep-alive',
				}),
				status: 200
			  };
	
			const { readable, writable } = new TransformStream();
			const encoder = new TextEncoder();
			const writer = writable.getWriter();
			let msgCount = 1;
	
			setInterval(() => {
				writer.write(encoder.encode(`data: ${`Welcome USER_${userId}, this is your visit #${userInfo.visit}`} "stream_seq: ${msgCount}" "rate: ${userInfo.rateLeft}"\n\n`));
				msgCount += 1;
				if (msgCount > 5) writer.close()
			}, 1000);
	
			return new Response(readable, response);

		} else {		
			const responseJson = {
				message: `Welcome USER_${userId}, this is your visit #${userInfo.visit}`,
				group: group,
				rate_limit_left: userInfo.rateLeft,
				stream_seq: 0,
			};
		
			return new Response(JSON.stringify(responseJson), {
				headers: { 'Content-Type': 'application/json' },
			});
			
		}
	}
};