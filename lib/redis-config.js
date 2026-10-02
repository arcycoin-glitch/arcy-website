// Server-only configuration. Never serialize or log the returned credentials.
module.exports=()=>({url:process.env.ARC_INDEX_REDIS_URL||process.env.UPSTASH_REDIS_REST_URL,token:process.env.ARC_INDEX_REDIS_TOKEN||process.env.UPSTASH_REDIS_REST_TOKEN});
