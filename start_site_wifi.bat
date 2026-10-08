@echo off
REM Open Day: same as start_site.bat, but also reachable from phones on the same
REM Wi-Fi, which is what the QR code needs. The window prints the address to use.
REM Windows asks once to allow Python through the firewall: say yes for private
REM networks. Close the window to stop the site.

cd /d "%~dp0"
call "%~dp0start_site.bat" --lan
