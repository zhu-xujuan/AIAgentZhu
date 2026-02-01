"""
Dify ワークフロー自動インポートスクリプト

使用方法:
1. Difyで管理者アカウントを作成
2. 設定 → APIキーを取得
3. 以下を実行:
   python scripts/import_to_dify.py --api-key YOUR_API_KEY
"""

import argparse
import requests
import yaml
import os

DIFY_BASE_URL = "http://localhost/v1"


def import_workflow(api_key: str, yaml_path: str):
    """Import a workflow from YAML file to Dify."""

    with open(yaml_path, 'r', encoding='utf-8') as f:
        content = f.read()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/yaml"
    }

    response = requests.post(
        f"{DIFY_BASE_URL}/apps/import",
        headers=headers,
        data=content
    )

    if response.status_code == 201:
        print(f"✓ Imported: {yaml_path}")
        return response.json()
    else:
        print(f"✗ Failed: {yaml_path}")
        print(f"  Status: {response.status_code}")
        print(f"  Response: {response.text}")
        return None


def main():
    parser = argparse.ArgumentParser(description="Import workflows to Dify")
    parser.add_argument("--api-key", required=True, help="Dify API key")
    parser.add_argument("--dify-url", default="http://localhost", help="Dify base URL")
    args = parser.parse_args()

    global DIFY_BASE_URL
    DIFY_BASE_URL = f"{args.dify_url}/v1"

    # Import workflows
    workflows = [
        "config/dify/workflows/ingestion_workflow.yml",
        "config/dify/workflows/query_workflow.yml"
    ]

    script_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    for wf in workflows:
        path = os.path.join(script_dir, wf)
        if os.path.exists(path):
            import_workflow(args.api_key, path)
        else:
            print(f"✗ File not found: {path}")


if __name__ == "__main__":
    main()
