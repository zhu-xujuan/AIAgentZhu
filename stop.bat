@echo off
echo ================================
echo AIAgent停止スクリプト
echo ================================
echo.

REM Docker Composeサービスを停止
echo データベースとバックエンドを停止中...
docker-compose down
if errorlevel 1 (
    echo 警告: docker-compose downでエラーが発生しました。
    echo コンテナが既に停止している可能性があります。
) else (
    echo Docker Composeサービス停止完了
)
echo.

REM コンテナの状態を確認
echo 現在のコンテナ状態:
docker-compose ps
echo.

echo ================================
echo 停止完了！
echo ================================
echo.
echo フロントエンドは手動で停止してください:
echo   1. フロントエンドのウィンドウ (AIAgent Frontend) でCtrl+Cを押す
echo   2. またはウィンドウを閉じる
echo.
echo コンテナを完全に削除する場合:
echo   docker-compose down -v
echo.
pause
