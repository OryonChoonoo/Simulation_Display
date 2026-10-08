@echo off
REM Open Day launcher: start the page on this laptop and open it in the browser.
REM Double-click this file. Close the black window to stop the site.
REM
REM   start_site.bat          this laptop only
REM   start_site.bat --lan    also reachable from phones on the same Wi-Fi

cd /d "%~dp0"

echo Starting the drive explorer...
start "" http://127.0.0.1:8790/?mode=kiosk
python serve.py 8790 %*

REM If the window closed immediately, Python is not on the PATH. Install it from
REM python.org and tick "Add python.exe to PATH", then try again.
pause
