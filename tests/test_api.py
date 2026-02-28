"""
ComfyCarry E2E — 后端 API 端点冒烟测试
验证关键 API 端点可达且返回正确状态码
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("TEST_BASE_URL", "http://localhost:5000")
API_KEY  = os.environ.get("TEST_API_KEY", "")
HEADERS  = {"X-API-Key": API_KEY} if API_KEY else {}


class TestSystemAPIs:
    """系统相关 API"""

    def test_version(self):
        r = requests.get(f"{BASE_URL}/api/version", headers=HEADERS, timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert "version" in data

    def test_overview(self):
        r = requests.get(f"{BASE_URL}/api/overview", headers=HEADERS, timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert "cpu" in data or "services" in data


class TestComfyUIAPIs:
    """ComfyUI 相关 API"""

    def test_status(self):
        r = requests.get(f"{BASE_URL}/api/comfyui/status", headers=HEADERS, timeout=5)
        assert r.status_code == 200

    def test_params(self):
        r = requests.get(f"{BASE_URL}/api/comfyui/params", headers=HEADERS, timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert "schema" in data or "params" in data or "current" in data


class TestModelsAPIs:
    """模型相关 API"""

    def test_local_models(self):
        r = requests.get(f"{BASE_URL}/api/local_models", headers=HEADERS, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, (list, dict))


class TestPluginsAPIs:
    """插件相关 API"""

    def test_installed(self):
        r = requests.get(f"{BASE_URL}/api/plugins/installed", headers=HEADERS, timeout=10)
        assert r.status_code == 200


class TestSyncAPIs:
    """同步相关 API"""

    def test_status(self):
        r = requests.get(f"{BASE_URL}/api/sync/status", headers=HEADERS, timeout=5)
        assert r.status_code == 200

    def test_remotes(self):
        r = requests.get(f"{BASE_URL}/api/sync/remotes", headers=HEADERS, timeout=5)
        assert r.status_code == 200

    def test_settings(self):
        r = requests.get(f"{BASE_URL}/api/sync/settings", headers=HEADERS, timeout=5)
        assert r.status_code == 200


class TestTunnelAPIs:
    """Tunnel 相关 API"""

    def test_status(self):
        r = requests.get(f"{BASE_URL}/api/tunnel/status", headers=HEADERS, timeout=5)
        assert r.status_code == 200


class TestSSHAPIs:
    """SSH 相关 API"""

    def test_status(self):
        r = requests.get(f"{BASE_URL}/api/ssh/status", headers=HEADERS, timeout=5)
        assert r.status_code == 200


class TestJupyterAPIs:
    """Jupyter 相关 API"""

    def test_status(self):
        r = requests.get(f"{BASE_URL}/api/jupyter/status", headers=HEADERS, timeout=5)
        assert r.status_code == 200
