"""Standard-library REST client. Service remains JavaScript; this is only a client example."""
import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    key = os.environ.get("REALITY_API_KEY")
    if not key or len(sys.argv) != 2:
        print("Set REALITY_API_KEY and pass one public HTTPS URL.", file=sys.stderr)
        return 2
    base = os.environ.get("REALITY_BASE_URL", "http://localhost:8080").rstrip("/")
    payload = {"url": sys.argv[1], "assert": {"status": 200}, "detail": "compact"}
    request = urllib.request.Request(
        f"{base}/v1/verify/website", data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            result = json.load(response)
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Request failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0 if result.get("verdict") == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
