#!/usr/bin/env python3
"""
自动生成 models.csv - 从模型 ID/URL 查询 CivitAI API 获取类型
"""

import requests
import csv
import sys
import os
import re
import time

def extract_model_id(text):
    """从 URL 或纯数字提取模型 ID 和版本 ID"""
    text = text.strip()
    
    # 如果是纯数字，直接返回
    if text.isdigit():
        return {'model_id': text, 'version_id': None}
    
    # 从 URL 提取
    # 格式1: https://civitai.com/models/1162518?modelVersionId=1714002
    # 格式2: https://civitai.com/models/1162518/plant-milk-model-suite
    
    model_id = None
    version_id = None
    
    # 提取 model_id
    match = re.search(r'/models/(\d+)', text)
    if match:
        model_id = match.group(1)
    
    # 提取 version_id (如果 URL 中有)
    match = re.search(r'modelVersionId=(\d+)', text)
    if match:
        version_id = match.group(1)
    
    if model_id:
        return {'model_id': model_id, 'version_id': version_id}
    
    return None


def query_civitai_model(model_id, api_key=None, retries=3):
    """查询 CivitAI API 获取模型信息和默认版本"""
    
    headers = {}
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'
    
    for attempt in range(retries):
        try:
            url = f"https://civitai.com/api/v1/models/{model_id}"
            response = requests.get(url, headers=headers, timeout=15)
            
            if response.status_code == 200:
                data = response.json()
                model_type = data.get('type', 'Unknown').lower()
                
                # 获取默认版本 ID (最新版本)
                default_version_id = None
                model_versions = data.get('modelVersions', [])
                if model_versions and len(model_versions) > 0:
                    default_version_id = str(model_versions[0].get('id', ''))
                
                # 映射 CivitAI 类型
                type_map = {
                    'lora': 'lora',
                    'checkpoint': 'checkpoint',
                    'textualinversion': 'lora',
                    'hypernetwork': 'lora',
                    'aestheticgradient': 'lora',
                    'controlnet': 'controlnet',
                    'poses': 'controlnet',
                    'vae': 'vae',
                    'upscaler': 'upscaler',
                }
                
                mapped_type = type_map.get(model_type, 'lora')
                
                return {
                    'model_id': model_id,
                    'type': mapped_type,
                    'default_version_id': default_version_id,
                    'success': True
                }
            else:
                print(f"  ⚠️ 模型 {model_id}: HTTP {response.status_code}", file=sys.stderr)
                
        except Exception as e:
            print(f"  ⚠️ 模型 {model_id} 查询失败 (尝试 {attempt + 1}/{retries}): {str(e)[:60]}", file=sys.stderr)
            if attempt < retries - 1:
                time.sleep(2)
    
    # 失败时返回默认类型
    return {
        'model_id': model_id,
        'type': 'lora',  # 默认为 lora
        'default_version_id': None,
        'success': False
    }


def generate_csv_from_ids(model_ids_text, api_key, output_file):
    """从逗号分隔的 ID 列表生成 CSV"""
    
    if not model_ids_text:
        print("❌ 未提供模型 ID", file=sys.stderr)
        return False
    
    # 解析 ID 列表
    items = [item.strip() for item in model_ids_text.split(',')]
    parsed_items = []
    
    for item in items:
        if not item:
            continue
        parsed = extract_model_id(item)
        if parsed:
            parsed_items.append(parsed)
        else:
            print(f"  ⚠️ 无法解析: {item}", file=sys.stderr)
    
    if not parsed_items:
        print("❌ 没有有效的模型 ID", file=sys.stderr)
        return False
    
    print(f"📊 共找到 {len(parsed_items)} 个模型", file=sys.stderr)
    print(f"🔍 正在查询 CivitAI API...", file=sys.stderr)
    
    # 查询所有模型
    results = []
    for i, item in enumerate(parsed_items, 1):
        model_id = item['model_id']
        url_version_id = item['version_id']
        
        print(f"  [{i}/{len(parsed_items)}] 查询模型 {model_id}...", file=sys.stderr)
        api_result = query_civitai_model(model_id, api_key)
        
        # 决定使用哪个版本 ID：URL 中指定的优先，否则使用 API 返回的默认版本
        final_version_id = url_version_id or api_result.get('default_version_id', '')
        
        results.append({
            'model_id': model_id,
            'type': api_result['type'],
            'version_id': final_version_id,
            'success': api_result['success']
        })
        
        if i < len(parsed_items):
            time.sleep(0.5)  # 避免请求过快
    
    # 写入 CSV
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        
        # 注释说明
        f.write("# model_id, type, version_id(可选), custom_name(可选)\n")
        f.write("# 此文件由 auto_generate_csv.py 自动生成\n")
        f.write("#\n")
        
        for result in results:
            # 格式: model_id,type,version_id,  (不指定 custom_name)
            writer.writerow([
                result['model_id'], 
                result['type'], 
                result['version_id'] or '', 
                ''
            ])
    
    success_count = sum(1 for r in results if r['success'])
    print(f"\n✅ CSV 生成完成: {output_file}", file=sys.stderr)
    print(f"   - 成功查询: {success_count}/{len(results)}", file=sys.stderr)
    
    return True


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='从模型 ID 自动生成 models.csv')
    parser.add_argument('--ids', required=True, help='逗号分隔的模型 ID 或 URL')
    parser.add_argument('--api-key', help='CivitAI API Key')
    parser.add_argument('-o', '--output', default='models.csv', help='输出文件路径')
    
    args = parser.parse_args()
    
    success = generate_csv_from_ids(args.ids, args.api_key, args.output)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
