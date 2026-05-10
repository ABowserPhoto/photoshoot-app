@echo off
cd C:\Users\aaron\Documents\photoshoot-app
pm2 start ./scripts/processing-worker.mjs --name "photo-worker"
pm2 save