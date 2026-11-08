@echo off
setlocal

rem Starts (or restarts) the in-cluster ngrok tunnel to the nginx ingress.
rem Usage:  ngrok.bat <authtoken>      first time, or to change the token
rem         ngrok.bat                  later runs (reuses the stored Secret)

if not "%~1"=="" (
    echo Storing ngrok authtoken in secret mx4/ngrok-authtoken...
    kubectl create secret generic ngrok-authtoken -n mx4 --from-literal=token=%~1 --dry-run=client -o yaml | kubectl apply -f -
) else (
    kubectl get secret ngrok-authtoken -n mx4 >nul 2>&1
    if errorlevel 1 (
        echo No ngrok authtoken stored yet. Run: ngrok.bat ^<your-authtoken^>
        echo Get it from https://dashboard.ngrok.com/get-started/your-authtoken
        exit /b 1
    )
)

echo Applying ngrok manifest...
kubectl apply -f kubernetes\ngrok.yaml
kubectl rollout restart deployment/ngrok -n mx4
kubectl rollout status deployment/ngrok -n mx4

echo.
echo Tunnel: https://glitter-setback-dares.ngrok-free.dev
echo Logs:   kubectl logs -f deploy/ngrok -n mx4
echo Inspector: kubectl port-forward deploy/ngrok 4040:4040 -n mx4  then open http://localhost:4040
endlocal
