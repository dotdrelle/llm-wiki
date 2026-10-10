/**
 * One way to show a time in the chat, in the BROWSER's time zone.
 *
 * Each panel used to format its own: the run journal showed the manager's UTC
 * clock (08:57:07 for a 10:57 event in Paris), the maintenance thread the
 * locale's "10/10/2026, 10:31:10 AM", the memory cards the raw ISO string. The
 * same event read three different ways. Times are now 24 h `HH:MM:SS`, dates
 * `YYYY-MM-DD HH:MM`, always local — whatever the browser's locale, since the
 * chrome stays English.
 *
 * Function declarations only: they are hoisted, so a panel that boots before
 * this block in the concatenated script can still call them.
 */
// Starts on a newline: it is concatenated into the chat script.
export const TIME_FORMAT_SCRIPT = `
function timePad2(n) { return String(n).padStart(2,'0'); }
function toLocalDate(value) {
  if(value==null||value==='') return null;
  const date=value instanceof Date?value:new Date(typeof value==='string'&&/^\\d+$/.test(value)?Number(value):value);
  return Number.isNaN(date.getTime())?null:date;
}
function formatLocalTime(value, options) {
  const date=toLocalDate(value);
  if(!date) return '';
  const seconds=options?.seconds!==false;
  return timePad2(date.getHours())+':'+timePad2(date.getMinutes())+(seconds?':'+timePad2(date.getSeconds()):'');
}
function formatLocalDateTime(value, options) {
  const date=toLocalDate(value);
  if(!date) return '';
  return date.getFullYear()+'-'+timePad2(date.getMonth()+1)+'-'+timePad2(date.getDate())+' '+formatLocalTime(date,{seconds:options?.seconds===true});
}
// The manager prefixes its log lines with an HH:MM:SS in UTC (agentEvents.js
// logTime, runtimeLog.js timeLabel) — a clock without a date. Re-express it in
// the browser's zone as the latest such instant that is not in the future.
function localClockFromUtc(clock, now) {
  const match=/^(\\d{2}):(\\d{2}):(\\d{2})$/.exec(String(clock||''));
  if(!match) return String(clock||'');
  const ref=now instanceof Date?now:new Date();
  const date=new Date(Date.UTC(ref.getUTCFullYear(),ref.getUTCMonth(),ref.getUTCDate(),Number(match[1]),Number(match[2]),Number(match[3])));
  if(date.getTime()-ref.getTime()>60000) date.setUTCDate(date.getUTCDate()-1);
  return formatLocalTime(date);
}`;
