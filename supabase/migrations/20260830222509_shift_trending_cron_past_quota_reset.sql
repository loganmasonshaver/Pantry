-- Move the trending crons to just AFTER the YouTube quota reset.
--
-- YouTube Data API quota is 10,000 units/day and resets at MIDNIGHT PACIFIC. A full pipeline run
-- costs ~1,314 units (13 search.list at 100 each, plus 14 videos.list at 1), so the day holds
-- exactly 7 runs.
--
-- The cron fired at 05:00 UTC, which is 22:00 Pacific the PREVIOUS day — about two hours BEFORE
-- the reset. So the daily run always drew from the old day's bucket, i.e. whatever was left after
-- a day of manual testing. On 2026-08-30 roughly 16 measurement runs exhausted the quota and the
-- night's cron would have returned "No YouTube results" through no fault of the pipeline.
--
-- 08:00 UTC = 01:00 Pacific puts it an hour past the reset, on a full bucket every day, and leaves
-- the other 6 runs for testing. The health check keeps its 20-minute offset so it still reports on
-- the run that just finished.
--
-- alter_job rather than unschedule+reschedule: it changes ONLY the schedule and leaves each job's
-- command body untouched, so the vault-secret lookup and function URL cannot be lost in a retype.
do $$
declare
  j record;
begin
  for j in
    select jobid, jobname, case jobname
      when 'trending-meals-daily'        then '0 8 * * *'
      when 'trending-health-check-daily' then '20 8 * * *'
    end as new_schedule
    from cron.job
    where jobname in ('trending-meals-daily', 'trending-health-check-daily')
  loop
    perform cron.alter_job(job_id := j.jobid, schedule := j.new_schedule);
    raise notice 'rescheduled % -> %', j.jobname, j.new_schedule;
  end loop;
end $$;
