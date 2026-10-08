@echo off
setlocal
if exist "%~dp0release\Animo-win32-x64\Animo.exe" (
    start "" "%~dp0release\Animo-win32-x64\Animo.exe"
    exit /b 0
)
pushd "%~dp0"
call npm start
set "animo_result=%errorlevel%"
popd
exit /b %animo_result%
