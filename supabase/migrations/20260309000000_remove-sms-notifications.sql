-- Drop notification_recipients table and all dependent objects
drop table if exists public.notification_recipients cascade;

-- Remove SMS-related keys from app_settings
delete from public.app_settings where key in ('sms_notification_settings', 'last_sms_notification_at');

-- Remove sms_notification from schedules table if present
delete from public.schedules where schedule_type = 'sms_notification';
