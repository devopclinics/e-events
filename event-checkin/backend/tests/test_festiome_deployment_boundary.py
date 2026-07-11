"""Static guards for FestioMe's deploy and data isolation."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_festiome_has_an_independent_container_and_database():
    compose = (ROOT / "docker-compose.yaml").read_text()
    assert "festiome-service:" in compose
    assert "festiome-db:" in compose
    assert "festiome-pgdata:" in compose
    assert "festiome-redisdata:" in compose
    assert "festiome-uploads:" in compose
    assert "festiome-db-backup:" in compose
    assert "festiome-db:5432/festiome" in compose


def test_proxy_routes_festiome_without_falling_through_guesthub():
    proxy = (ROOT / "proxy.conf").read_text()
    assert "location /api/festiome/" in proxy
    assert "festiome-service" in proxy
    assert "resolver 127.0.0.11" in proxy
    assert "proxy_pass $festiome_upstream" in proxy
