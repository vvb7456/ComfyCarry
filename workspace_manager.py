#!/usr/bin/env python3
"""
ComfyCarry v2.4 — Workspace Manager
云端 ComfyUI 部署管理平台

这是一个薄包装器，实际逻辑已模块化至 comfycarry/ 包。
启动: python workspace_manager.py [port]
"""

from comfycarry.app import main

if __name__ == "__main__":
    main()
