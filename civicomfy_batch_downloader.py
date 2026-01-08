#!/usr/bin/env python3
"""
Civicomfy 批量下载器 - 自动化脚本
支持从文件读取模型列表并通过 REST API 批量下载
用于 deploy.sh 脚本中的无人值守模型下载
"""

import requests
import json
import time
import sys
import os
from typing import List, Dict, Optional
from pathlib import Path

class CivitaiAutoDownloader:
    """通过 Civicomfy REST API 自动化下载管理器"""
    
    def __init__(
        self,
        comfyui_url: str = "http://localhost:8188",
        api_key: str = "",
        max_retries: int = 3,
        retry_delay: int = 5,
        verbose: bool = True
    ):
        self.base_url = comfyui_url.rstrip('/')
        self.api_key = api_key
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.verbose = verbose
        self.session = requests.Session()
        self.download_ids = []
        self.failed_models = []
    
    def log(self, msg: str):
        """打印日志"""
        if self.verbose:
            print(msg)
    
    def is_civitai_url(self, url: str) -> bool:
        """判断是否为 CivitAI URL"""
        return "civitai.com" in url.lower()
    
    def extract_model_id_from_url(self, url: str) -> Optional[str]:
        """从 URL 提取模型 ID"""
        try:
            # 格式: https://civitai.com/models/12345 或 https://civitai.com/models/12345?...
            if "/models/" in url:
                parts = url.split("/models/")[1].split("?")[0].split("#")[0]
                return parts.split("/")[0].strip()
        except:
            pass
        return None
    
    def load_models_from_csv(self, csv_path: str) -> List[Dict]:
        """从 CSV 加载模型列表
        
        CSV 格式 (无表头):
        model_id_or_url,model_type,version_id(可选),custom_filename(可选)
        
        示例:
        12345,checkpoint,,
        https://civitai.com/models/67890,lora,,MyLora
        11111,controlnet,98765,ControlNet-Model
        """
        models = []
        line_num = 0
        
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line_num += 1
                    line = line.strip()
                    
                    # 跳过空行和注释
                    if not line or line.startswith('#'):
                        continue
                    
                    parts = [p.strip() for p in line.split(',')]
                    
                    if len(parts) < 2:
                        self.log(f"⚠️  CSV行{line_num}格式错误，跳过：{line}")
                        continue
                    
                    model_id_or_url = parts[0]
                    model_type = parts[1]
                    
                    # 如果是 URL，提取模型 ID
                    if self.is_civitai_url(model_id_or_url):
                        extracted_id = self.extract_model_id_from_url(model_id_or_url)
                        if not extracted_id:
                            self.log(f"⚠️  CSV行{line_num}无法从URL提取模型ID，跳过：{model_id_or_url}")
                            continue
                        model_id_or_url = extracted_id
                    
                    models.append({
                        'model_id': model_id_or_url,
                        'model_type': model_type,
                        'version_id': parts[2] if len(parts) > 2 and parts[2] else None,
                        'custom_filename': parts[3] if len(parts) > 3 and parts[3] else None,
                    })
        
        except FileNotFoundError:
            self.log(f"❌ CSV文件不存在：{csv_path}")
            return []
        except Exception as e:
            self.log(f"❌ CSV文件读取错误：{e}")
            return []
        
        self.log(f"✅ 从 {csv_path} 加载了 {len(models)} 个模型")
        return models
    
    def parse_model_list_from_env(self, env_var: str) -> List[Dict]:
        """从环境变量解析模型列表 (逗号分隔的ID/URL)
        
        格式: ID1,ID2,URL3,ID4
        示例: 12345,67890,https://civitai.com/models/11111,22222
        """
        models = []
        
        env_value = os.getenv(env_var, "")
        if not env_value:
            return []
        
        items = [item.strip() for item in env_value.split(',')]
        
        for item in items:
            if not item:
                continue
            
            # 检查是否为 URL
            if self.is_civitai_url(item):
                model_id = self.extract_model_id_from_url(item)
                if not model_id:
                    self.log(f"⚠️  无法从URL提取模型ID：{item}")
                    continue
            else:
                model_id = item
            
            # 默认为 checkpoint，可通过特殊前缀修改
            model_type = "checkpoint"
            if model_id.startswith("lora:"):
                model_type = "lora"
                model_id = model_id[5:]
            elif model_id.startswith("controlnet:"):
                model_type = "controlnet"
                model_id = model_id[11:]
            elif model_id.startswith("vae:"):
                model_type = "vae"
                model_id = model_id[4:]
            elif model_id.startswith("upscaler:"):
                model_type = "upscaler"
                model_id = model_id[9:]
            
            models.append({
                'model_id': model_id,
                'model_type': model_type,
                'version_id': None,
                'custom_filename': None,
            })
        
        if models:
            self.log(f"✅ 从环境变量 {env_var} 解析了 {len(models)} 个模型")
        
        return models
    
    def wait_for_comfyui(self, timeout: int = 60) -> bool:
        """等待 ComfyUI 启动"""
        self.log(f"⏳ 等待 ComfyUI 启动... (超时: {timeout}秒)")
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                response = self.session.get(f"{self.base_url}/system_stats", timeout=5)
                if response.status_code == 200:
                    self.log("✅ ComfyUI 已启动")
                    return True
            except:
                pass
            
            time.sleep(2)
        
        self.log("❌ ComfyUI 启动超时")
        return False
    
    def download_model(
        self,
        model_id: str,
        model_type: str = "checkpoint",
        version_id: Optional[str] = None,
        custom_filename: Optional[str] = None
    ) -> Optional[str]:
        """下载单个模型，返回 download_id"""
        
        payload = {
            "model_url_or_id": model_id,
            "model_type": model_type,
            "api_key": self.api_key,
            "num_connections": 4
        }
        
        if version_id:
            try:
                payload["model_version_id"] = int(version_id)
            except ValueError:
                pass
        
        if custom_filename:
            payload["custom_filename"] = custom_filename
        
        for attempt in range(self.max_retries):
            try:
                response = self.session.post(
                    f"{self.base_url}/civitai/download",
                    json=payload,
                    timeout=30
                )
                response.raise_for_status()
                
                result = response.json()
                if result.get("status") == "queued":
                    download_id = result["download_id"]
                    self.download_ids.append(download_id)
                    
                    filename = result.get('details', {}).get('filename', '未知文件')
                    self.log(f"  ✓ [{model_id}] 已加入队列: {filename}")
                    return download_id
                else:
                    self.log(f"  ✗ [{model_id}] 意外的状态: {result.get('status', '未知')}")
                    return None
                    
            except requests.exceptions.ConnectTimeout:
                self.log(f"  ⚠️  [{model_id}] 第 {attempt+1}/{self.max_retries} 次尝试失败: 连接超时")
            except requests.exceptions.HTTPError as e:
                error_msg = str(e)
                if "404" in error_msg:
                    self.log(f"  ✗ [{model_id}] 模型不存在或 API Key 无效")
                    return None
                self.log(f"  ⚠️  [{model_id}] 第 {attempt+1}/{self.max_retries} 次尝试失败: HTTP错误")
            except Exception as e:
                self.log(f"  ⚠️  [{model_id}] 第 {attempt+1}/{self.max_retries} 次尝试失败: {str(e)[:50]}")
            
            if attempt < self.max_retries - 1:
                time.sleep(self.retry_delay)
            else:
                self.failed_models.append(model_id)
                self.log(f"  ✗ [{model_id}] 失败，已放弃 ({self.max_retries} 次尝试)")
                return None
    
    def batch_download(self, models: List[Dict]) -> Dict:
        """批量下载多个模型"""
        if not models:
            self.log("⚠️  模型列表为空，无需下载")
            return {
                'total': 0,
                'successful': 0,
                'failed': 0,
                'download_ids': []
            }
        
        results = {
            'total': len(models),
            'successful': 0,
            'failed': 0,
            'download_ids': []
        }
        
        self.log(f"\n📥 开始批量下载 {len(models)} 个模型...\n")
        
        for idx, model in enumerate(models, 1):
            self.log(f"[{idx}/{len(models)}] 处理: {model['model_id']} (类型: {model['model_type']})")
            
            download_id = self.download_model(
                model_id=model['model_id'],
                model_type=model.get('model_type', 'checkpoint'),
                version_id=model.get('version_id'),
                custom_filename=model.get('custom_filename')
            )
            
            if download_id:
                results['download_ids'].append(download_id)
                results['successful'] += 1
            else:
                results['failed'] += 1
            
            # 避免请求过快
            if idx < len(models):
                time.sleep(1)
        
        self.log(f"\n📊 批量下载摘要: {results['successful']}/{results['total']} 成功加入队列, {results['failed']} 失败")
        return results
    
    def get_status(self) -> Dict:
        """获取当前下载状态"""
        try:
            response = self.session.get(
                f"{self.base_url}/civitai/status",
                timeout=10
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            self.log(f"❌ 无法获取下载状态: {e}")
            return {'queue': [], 'active': [], 'history': []}
    
    def wait_all_downloads(
        self,
        check_interval: int = 10,
        timeout: int = 3600,
        max_parallel_downloads: int = 4
    ) -> Dict:
        """等待所有下载完成"""
        if not self.download_ids:
            self.log("⚠️  无下载任务")
            return {
                'total': 0,
                'completed': 0,
                'failed': 0,
                'pending': 0
            }
        
        self.log(f"\n⏳ 等待 {len(self.download_ids)} 个下载任务完成... (超时: {timeout}秒)")
        
        start_time = time.time()
        completed = []
        failed = []
        last_progress_time = start_time
        
        while time.time() - start_time < timeout:
            status = self.get_status()
            
            # 检查已完成和失败的下载
            for download_id in self.download_ids:
                if download_id in completed or download_id in failed:
                    continue
                
                # 在 history 或 active 中查找
                download = next(
                    (d for d in status.get('history', []) + status.get('active', [])
                     if d.get('id') == download_id),
                    None
                )
                
                if download:
                    if download['status'] == 'completed':
                        completed.append(download_id)
                        size_gb = download.get('size_kb', 0) / (1024 * 1024)
                        self.log(f"  ✓ 完成: {download['filename']} ({size_gb:.2f} GB)")
                    elif download['status'] == 'failed':
                        failed.append(download_id)
                        error_msg = download.get('error', '未知错误')
                        self.log(f"  ✗ 失败: {download['filename']} - {error_msg}")
            
            # 定期打印进度
            current_time = time.time()
            if current_time - last_progress_time >= 60:
                pending = len(self.download_ids) - len(completed) - len(failed)
                active = status.get('active', [])
                self.log(f"📊 进度: {len(completed)} 完成, {len(active)} 进行中, {pending} 等待中")
                last_progress_time = current_time
            
            # 检查是否全部完成
            if len(completed) + len(failed) == len(self.download_ids):
                break
            
            time.sleep(check_interval)
        
        final_result = {
            'total': len(self.download_ids),
            'completed': len(completed),
            'failed': len(failed),
            'pending': len(self.download_ids) - len(completed) - len(failed)
        }
        
        self.log(f"\n✅ 下载完成统计: {final_result['completed']} 完成, {final_result['failed']} 失败, {final_result['pending']} 未完成")
        
        return final_result


def main():
    """命令行入口"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Civicomfy 批量下载器 - 通过 REST API 自动下载模型",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 从 CSV 文件下载
  %(prog)s --api-key YOUR_KEY --csv models.csv --wait
  
  # 从环境变量下载 (逗号分隔的 ID)
  %(prog)s --api-key YOUR_KEY --env-var ALL_MODEL_IDS --wait
  
  # 只发起下载，不等待
  %(prog)s --api-key YOUR_KEY --csv models.csv
        """
    )
    
    parser.add_argument("--url", default="http://localhost:8188", help="ComfyUI URL (默认: http://localhost:8188)")
    parser.add_argument("--api-key", required=True, help="CivitAI API Key (必需)")
    parser.add_argument("--csv", help="模型列表 CSV 文件路径")
    parser.add_argument("--env-var", help="从环境变量读取模型列表 (逗号分隔)")
    parser.add_argument("--wait", action="store_true", help="等待所有下载完成")
    parser.add_argument("--timeout", type=int, default=3600, help="等待超时时间 (秒，默认: 3600)")
    parser.add_argument("--check-interval", type=int, default=10, help="检查状态间隔 (秒，默认: 10)")
    parser.add_argument("--no-wait-startup", action="store_true", help="不等待 ComfyUI 启动")
    
    args = parser.parse_args()
    
    # 验证参数
    if not args.csv and not args.env_var:
        parser.error("必须指定 --csv 或 --env-var 之一")
    
    # 创建下载器
    downloader = CivitaiAutoDownloader(
        comfyui_url=args.url,
        api_key=args.api_key,
        verbose=True
    )
    
    # 等待 ComfyUI 启动
    if not args.no_wait_startup:
        if not downloader.wait_for_comfyui():
            sys.exit(1)
    
    # 加载模型列表
    models = []
    
    if args.csv:
        if not Path(args.csv).exists():
            print(f"❌ CSV 文件不存在: {args.csv}")
            sys.exit(1)
        models = downloader.load_models_from_csv(args.csv)
    
    if args.env_var:
        env_models = downloader.parse_model_list_from_env(args.env_var)
        models.extend(env_models)
    
    if not models:
        print("❌ 没有加载任何模型")
        sys.exit(1)
    
    # 批量下载
    results = downloader.batch_download(models)
    
    if results['successful'] == 0:
        print("❌ 没有成功加入任何下载")
        sys.exit(1)
    
    # 可选: 等待完成
    if args.wait:
        final = downloader.wait_all_downloads(
            check_interval=args.check_interval,
            timeout=args.timeout
        )
        
        if final['failed'] > 0 or final['pending'] > 0:
            sys.exit(1)
    
    sys.exit(0)


if __name__ == "__main__":
    main()
