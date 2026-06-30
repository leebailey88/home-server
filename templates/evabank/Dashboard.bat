c:
cd \dashboard

IF EXIST GL Dash DEL GL Dash
IF EXIST CD Dash DEL CD Dash
IF EXIST LN Dash DEL LN Dash

rxferpcb GLDash.dtf DASHBOARD xxxxxxxx
rxferpcb CDDash.dtf DASHBOARD xxxxxxxx	
rxferpcb LNDash.dtf DASHBOARD xxxxxxxx

REM Existing Banker's Dashboard upload. Leave this untouched.
db-upload.vbs

REM Community Bank Pilot parallel upload.
REM This script intentionally exits 0 on failure so it does not affect Banker's Dashboard.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Dashboard\CBP-Upload.ps1
