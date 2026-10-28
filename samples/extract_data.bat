@echo off

:: Prepares the chess sample data and saves each backup made from it
:: (Windows version of extract_data.sh)

set DIR=%~dp0
set PATH=%PATH%;C:\Program Files\7-Zip\


if not exist C:\Users\Acronis mkdir C:\Users\Acronis
::takeown /f C:\Users\Acronis /r /d y

cd /d C:\Users\Acronis

:: Clearing old data
if exist chess rd /s /q chess

echo "Extracting version A"
set HASH=bfc47df6562b2e4f0a1d0a5dc8a526d9b7c103db
if exist chess-%HASH% rd /s /q chess-%HASH%
7z x "%DIR%\data\chess-%HASH%.zip" -y > NUL
move chess-%HASH% chess

echo Please archive from 'C:\Users\Acronis\chess' to '%DIR%win\' with name 'chess'.

set /p DUMMY=Hit ENTER to continue after completed...

echo "Saving version A"
if not exist "%DIR%win\chess-a" mkdir "%DIR%win\chess-a"
copy /y "%DIR%win\chess_*.tib" "%DIR%win\chess-a\" > NUL || goto :copyfailed

:: Clear again
rd /s /q chess


echo "Extracting version B"
set HASH=675ab91843499aa0b7e18293f1bbe7464b05a9c1
if exist chess-%HASH% rd /s /q chess-%HASH%
7z x "%DIR%\data\chess-%HASH%.zip" -y > NUL
move chess-%HASH% chess

echo Please back up a new version (just hit 'Back Up' on the same item).

set /p DUMMY=Hit ENTER to continue after completed...

echo "Saving version B"
if not exist "%DIR%win\chess-b" mkdir "%DIR%win\chess-b"
copy /y "%DIR%win\chess_*.tib" "%DIR%win\chess-b\" > NUL || goto :copyfailed

:: Remove the working files so the next run starts a new archive (copies are kept in chess-a and chess-b)
del /q "%DIR%win\chess_*.tib"

echo Done.
exit /b 0

:copyfailed
echo Could not find the backup files in '%DIR%win\'. Was the backup saved there with the name 'chess'?
exit /b 1
