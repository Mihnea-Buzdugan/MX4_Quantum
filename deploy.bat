@echo off

echo Building frontend image...
docker build -t mx4-frontend:latest ./frontend

echo Building backend image...
docker build -t mx4-backend:latest ./backend

echo Restarting deployments...

kubectl rollout restart deployment/frontend -n mx4
kubectl rollout restart deployment/backend -n mx4

echo Waiting for deployments...

kubectl rollout status deployment/frontend -n mx4
kubectl rollout status deployment/backend -n mx4

echo Deployment completed!
pause
