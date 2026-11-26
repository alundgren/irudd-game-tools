@echo off
rem irudd launcher for a source checkout (development). Runs the CLI, the
rem headless host ("irudd host") or the MCP server ("irudd mcp") with the
rem workspace's source resolver. A packaged build replaces this launcher.
setlocal
set "IRUDD_ROOT=%~dp0..\..\.."
for %%I in ("%IRUDD_ROOT%") do set "IRUDD_ROOT=%%~fI"
set "IRUDD_LOADER=%IRUDD_ROOT:\=/%/packages/document/test/support/register.ts"
set "IRUDD_LOADER=file:///%IRUDD_LOADER%"
set "IRUDD_ENTRY=%IRUDD_ROOT%\apps\cli\src\main.ts"
rem Steering messages tell agents to run this launcher.
if not defined IRUDD_AGENT_COMMAND set "IRUDD_AGENT_COMMAND=%IRUDD_ROOT%\apps\cli\bin\irudd.cmd"
if /i "%~1"=="host" set "IRUDD_ENTRY=%IRUDD_ROOT%\packages\workshop\src\host\main.ts"
if /i "%~1"=="mcp" set "IRUDD_ENTRY=%IRUDD_ROOT%\apps\mcp\src\main.ts"
if /i "%~1"=="host" goto shifted
if /i "%~1"=="mcp" goto shifted
node --no-warnings=ExperimentalWarning --import "%IRUDD_LOADER%" "%IRUDD_ENTRY%" %*
exit /b %ERRORLEVEL%
:shifted
shift
set "IRUDD_ARGS="
:collect
if "%~1"=="" goto run
set IRUDD_ARGS=%IRUDD_ARGS% %1
shift
goto collect
:run
node --no-warnings=ExperimentalWarning --import "%IRUDD_LOADER%" "%IRUDD_ENTRY%" %IRUDD_ARGS%
exit /b %ERRORLEVEL%
