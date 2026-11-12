import {z} from 'zod';

const minutes=z.number().int().min(0).max(1440);
const explanation=z.string().trim().min(1).max(5000);
export const planReviewSchema=z.object({
 spatialNotes:explanation.describe('Explain geographical grouping and any necessary returns due to lodging, reservations or weather. Do not invent constraints.'),
 days:z.array(z.object({
  date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  availableMinutes:minutes.min(1).describe('Real usable day window, respecting departure/return constraints. Count each transport segment once.'),
  travelMinutes:minutes,visitMinutes:minutes,mealRestMinutes:minutes,bufferMinutes:minutes,
  basis:explanation.describe('Summarize day window, visit scope and duration sources, transfers/queues and which values are estimates. A place coordinate is not a visit duration.'),
 }).strict()).min(1).max(366),
}).strict();
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

/** Checks submitted arithmetic and coverage, not real-world truth or optimality. */
export function validatePlanReview(days,review){
 if(!review)fail('PLAN_REVIEW_REQUIRED','New apply_plan tasks require review: spatialNotes and one daily time budget per submitted date. Check real visit scope, transport, meals/rest and buffer first; do not bypass this check with lower-level tools.');
 const parsed=planReviewSchema.safeParse(review);
 if(!parsed.success)fail('INVALID_PLAN_REVIEW',parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));
 const dates=new Set(days.map(day=>day.date)),reviewed=parsed.data.days;
 if(reviewed.length!==dates.size||new Set(reviewed.map(day=>day.date)).size!==reviewed.length||reviewed.some(day=>!dates.has(day.date)))
  fail('INVALID_PLAN_REVIEW','review.days must cover every submitted plan date exactly once, with no extra dates.');
 for(const day of reviewed){
  const total=day.travelMinutes+day.visitMinutes+day.mealRestMinutes+day.bufferMinutes;
  if(total>day.availableMinutes)fail('PLAN_TIME_EXCEEDED',`${day.date}: travel ${day.travelMinutes} + visits ${day.visitMinutes} + meals/rest ${day.mealRestMinutes} + buffer ${day.bufferMinutes} = ${total} minutes, exceeding the available ${day.availableMinutes}. Reduce or reorder activities and review actual constraints; do not inflate availability, compress unsupported visit times, or bypass with lower-level tools.`);
 }
 return parsed.data;
}
