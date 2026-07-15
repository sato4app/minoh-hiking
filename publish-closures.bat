@echo off
rem Launcher for publish-closures.ps1 (double-click to publish closures).
rem All logic and Japanese messages live in the .ps1 file (UTF-8).
rem This file must stay ASCII-only to avoid cmd codepage issues.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publish-closures.ps1"
exit /b %ERRORLEVEL%
