@echo off
echo ================================
echo AIAgent 初期セットアップ
echo ================================
echo.
echo このスクリプトは以下を実行します:
echo 1. フロントエンドの依存関係インストール
echo 2. 環境設定ファイルの確認
echo 3. Dockerイメージのビルド
echo.
pause
echo.

REM フロントエンドの依存関係をインストール
echo [1/3] フロントエンドの依存関係をインストール中...
cd frontend
call npm install
if %errorlevel% neq 0 (
    echo エラー: npm installに失敗しました。
    pause
    exit /b 1
)
cd ..
echo.

REM 環境設定ファイルの確認
echo [2/3] 環境設定ファイルを確認中...

if not exist "backend\.env" (
    echo エラー: backend\.env が見つかりません。
    echo .env.exampleを参考にbackend\.envを作成してください。
    pause
    exit /b 1
) else (
    echo backend\.env: OK
)

if not exist "frontend\.env.local" (
    echo エラー: frontend\.env.local が見つかりません。
    echo .env.exampleを参考にfrontend\.env.localを作成してください。
    pause
    exit /b 1
) else (
    echo frontend\.env.local: OK
)
echo.

REM Dockerイメージをビルド
echo [3/3] Dockerイメージをビルド中...
docker-compose build
if %errorlevel% neq 0 (
    echo エラー: Dockerイメージのビルドに失敗しました。
    pause
    exit /b 1
)
echo.

echo ================================
echo セットアップ完了！
echo ================================
echo.
echo 次のコマンドでアプリケーションを起動できます:
echo start.bat
echo.
pause
