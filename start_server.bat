@echo off
title StockMaster - DBMS Web Application Server
cd /d "%~dp0"
echo ======================================================================
echo   STOCKMASTER — DATABASE MANAGEMENT SYSTEM BACKEND SERVER
echo   Department of AI - Amrita Vishwa Vidyapeetham - Group 18
echo ======================================================================
echo.
echo Starting Flask web server at http://localhost:5000/ ...
echo Keep this window open or minimized during your presentation!
echo.
python server.py
pause
