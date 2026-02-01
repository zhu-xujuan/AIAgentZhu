@echo off
setlocal enabledelayedexpansion

echo ================================
echo AIAgent起動スクリプト
echo ================================
echo.

REM Docker Desktopの起動確認
echo [0/5] Docker Desktopの起動を確認中...
docker version >nul 2>&1
if errorlevel 1 (
    echo エラー: Docker Desktopが起動していません。
    echo Docker Desktopを起動してから、再度このスクリプトを実行してください。
    echo.
    pause
    exit /b 1
)
echo Docker Desktop: 起動確認完了
echo.

REM フロントエンドの依存関係を確認
echo [1/5] フロントエンドの依存関係を確認中...
if not exist "frontend" (
    echo エラー: frontendディレクトリが見つかりません。
    pause
    exit /b 1
)
cd frontend
if not exist "node_modules" (
    echo node_modulesが見つかりません。依存関係をインストール中...
    call npm install
    if errorlevel 1 (
        echo エラー: npm installに失敗しました。
        cd ..
        pause
        exit /b 1
    )
) else (
    echo 依存関係は既にインストールされています。
)
cd ..
echo.

REM データベースとバックエンドを起動
echo [2/5] データベースとバックエンドを起動中...
docker-compose up -d
if errorlevel 1 (
    echo エラー: docker-compose upに失敗しました。
    pause
    exit /b 1
)
echo Docker Composeサービス起動完了
echo.

REM バックエンドの起動を待機
echo [3/5] バックエンドの起動を待機中...
echo (バックエンドのコンテナが起動し、依存関係がインストールされるまで待機します)
timeout /t 20 /nobreak > nul
echo.

REM バックエンドのヘルスチェック
echo [4/5] バックエンドのヘルスチェック中...
set MAX_RETRIES=5
set RETRY_COUNT=0

:health_check_loop
curl -s http://localhost:8000/health >nul 2>&1
if errorlevel 1 (
    set /a RETRY_COUNT+=1
    if !RETRY_COUNT! lss %MAX_RETRIES% (
        echo バックエンドがまだ起動していません... 再試行中 (!RETRY_COUNT!/%MAX_RETRIES%^)
        timeout /t 3 /nobreak > nul
        goto health_check_loop
    ) else (
        echo 警告: バックエンドのヘルスチェックに失敗しました。
        echo バックエンドのログを確認してください: docker-compose logs backend
        echo.
    )
) else (
    echo バックエンド: 起動確認完了
)
echo.

REM フロントエンドを起動
echo [5/5] フロントエンドを起動中...
cd frontend
start "AIAgent Frontend" cmd /k "npm run dev"
cd ..
echo.

echo ================================
echo 起動完了！
echo ================================
echo.
echo フロントエンド: http://localhost:3000
echo バックエンドAPI: http://localhost:8000
echo API ドキュメント: http://localhost:8000/docs
echo データベース: localhost:5432
echo.
echo ログ確認コマンド:
echo   docker-compose logs backend
echo   docker-compose logs postgres
echo.
echo Ctrl+C を押してこのウィンドウを閉じてください。
echo フロントエンドは別ウィンドウで実行されています。
echo.
pause
