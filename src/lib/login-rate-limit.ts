type Attempt={count:number;resetAt:number};

const attempts=new Map<string,Attempt>();
const windowMs=15*60*1000;
const maximumAttempts=5;

export function loginRateLimit(key:string,now=Date.now()) {
  const current=attempts.get(key);
  if (!current || current.resetAt<=now) {
    const next={count:1,resetAt:now+windowMs};
    attempts.set(key,next);
    return {allowed:true,retryAfterSeconds:0};
  }
  current.count+=1;
  if (current.count<=maximumAttempts) return {allowed:true,retryAfterSeconds:0};
  return {allowed:false,retryAfterSeconds:Math.max(1,Math.ceil((current.resetAt-now)/1000))};
}

export function clearLoginRateLimit(key:string) {
  attempts.delete(key);
}
