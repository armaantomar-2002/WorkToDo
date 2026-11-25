\set U1 '00000000-0000-4000-8000-000000000001'
\set U2 '00000000-0000-4000-8000-000000000002'
\set T1 '00000000-0000-4000-8000-0000000000b1'
\set ON_ERROR_STOP 0
\set VERBOSITY terse
INSERT INTO "ScheduleVersion"(id,"userId","versionNumber",status,mode,"orderSource","horizonFrom","horizonTo","generatedAtLocal","inputHash",summary,"updatedAt") VALUES ('10000000-0000-4000-8000-000000000001',:'U1',1,'draft','fresh','ml','2026-11-25','2026-12-01','2026-11-25 09:00','h','{}',now());
\echo EXPECT-FAIL second draft:
INSERT INTO "ScheduleVersion"(id,"userId","versionNumber",status,mode,"orderSource","horizonFrom","horizonTo","generatedAtLocal","inputHash",summary,"updatedAt") VALUES ('10000000-0000-4000-8000-000000000002',:'U1',2,'draft','fresh','ml','2026-11-25','2026-12-01','2026-11-25 09:00','h','{}',now());
INSERT INTO "ScheduleVersion"(id,"userId","versionNumber",status,mode,"orderSource","horizonFrom","horizonTo","generatedAtLocal","inputHash",summary,"updatedAt") VALUES ('10000000-0000-4000-8000-000000000003',:'U1',3,'approved','fresh','ml','2026-11-25','2026-12-01','2026-11-25 09:00','h','{}',now());
\echo EXPECT-FAIL second approved:
INSERT INTO "ScheduleVersion"(id,"userId","versionNumber",status,mode,"orderSource","horizonFrom","horizonTo","generatedAtLocal","inputHash",summary,"updatedAt") VALUES ('10000000-0000-4000-8000-000000000004',:'U1',4,'approved','fresh','ml','2026-11-25','2026-12-01','2026-11-25 09:00','h','{}',now());
\echo OK task block:
INSERT INTO "ScheduledBlock"(id,"scheduleVersionId","userId",kind,"taskId","startAt","endAt","updatedAt") VALUES ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',:'U1','task',:'T1','2026-11-25 09:00','2026-11-25 10:00',now());
\echo EXPECT-FAIL task block without task:
INSERT INTO "ScheduledBlock"(id,"scheduleVersionId","userId",kind,"startAt","endAt","updatedAt") VALUES ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',:'U1','task','2026-11-25 09:00','2026-11-25 10:00',now());
\echo EXPECT-FAIL break with task:
INSERT INTO "ScheduledBlock"(id,"scheduleVersionId","userId",kind,"taskId","startAt","endAt","updatedAt") VALUES ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',:'U1','break',:'T1','2026-11-25 09:00','2026-11-25 10:00',now());
\echo EXPECT-FAIL end before start:
INSERT INTO "ScheduledBlock"(id,"scheduleVersionId","userId",kind,"taskId","startAt","endAt","updatedAt") VALUES ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',:'U1','task',:'T1','2026-11-25 10:00','2026-11-25 09:00',now());
\echo EXPECT-FAIL other user task in my schedule block:
INSERT INTO "ScheduledBlock"(id,"scheduleVersionId","userId",kind,"taskId","startAt","endAt","updatedAt") VALUES ('20000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000001',:'U2','task',:'T1','2026-11-25 09:00','2026-11-25 10:00',now());
\echo EXPECT-FAIL appointment end before start:
INSERT INTO "Appointment"(id,"userId",title,"startAt","endAt","updatedAt") VALUES ('30000000-0000-4000-8000-000000000001',:'U1','x','2026-11-25 12:00','2026-11-25 11:00',now());
\echo EXPECT-FAIL appointment buffer 500:
INSERT INTO "Appointment"(id,"userId",title,"startAt","endAt","travelBufferMinutes","updatedAt") VALUES ('30000000-0000-4000-8000-000000000002',:'U1','x','2026-11-25 11:00','2026-11-25 12:00',500,now());
\echo EXPECT-FAIL cancelled without cancelledAt:
INSERT INTO "Appointment"(id,"userId",title,"startAt","endAt",status,"updatedAt") VALUES ('30000000-0000-4000-8000-000000000003',:'U1','x','2026-11-25 11:00','2026-11-25 12:00','cancelled',now());
\echo OK appointment:
INSERT INTO "Appointment"(id,"userId",title,"startAt","endAt","updatedAt") VALUES ('30000000-0000-4000-8000-000000000004',:'U1','Doctor','2026-11-25 11:00','2026-11-25 13:00',now());
\echo EXPECT-FAIL history for other user:
INSERT INTO "AppointmentHistory"(id,"appointmentId","userId",action) VALUES ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004',:'U2','created');
\echo EXPECT-FAIL work hours end<start:
UPDATE "UserPreferences" SET "workDayEnd"='08:00';
\echo EXPECT-FAIL bad workDays:
UPDATE "UserPreferences" SET "workDays"='1,9';
\echo EXPECT-OK cascade: deleting version removes its blocks:
DELETE FROM "ScheduleVersion" WHERE id='10000000-0000-4000-8000-000000000001';
SELECT count(*) AS blocks_left FROM "ScheduledBlock";
