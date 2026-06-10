#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path


IMAGE_LINE = re.compile(r"^(?P<indent>\s*)image:\s*(?P<image>\S+)\s*$")
FORBIDDEN_IMAGE_PATTERNS = [
    re.compile(r"(^|/)\.git($|/)"),
    re.compile(r"(^|/)\.claude($|/)"),
    re.compile(r"(^|/)\.factory($|/)"),
    re.compile(r"(^|/)node_modules($|/)"),
    re.compile(r"(^|/)dist($|/)"),
    re.compile(r"(^|/)\.env(?:[./]|$)"),
    re.compile(
        r"(^|/)(?:id_rsa|id_ed25519|.*private[-_]?key.*|.*(?:^|[-_.])key(?:[-_.]|$).*\.pem|.*(?:^|[-_.])priv(?:ate)?(?:[-_.]|$).*\.pem)$",
        re.I,
    ),
    re.compile(r"(^|/).*\.(?:sqlite|sqlite3|db|duckdb)$", re.I),
]


def compose_image_violations(files: list[Path]) -> list[str]:
    violations: list[str] = []
    for file in files:
        if not file.exists():
            continue
        for lineno, line in enumerate(file.read_text().splitlines(), start=1):
            match = IMAGE_LINE.match(line)
            if not match:
                continue
            image = match.group("image")
            if "@sha256:" not in image:
                violations.append(f"{file}:{lineno}: {image}")
    return violations


def compose_images(files: list[Path]) -> list[str]:
    images: list[str] = []
    for file in files:
        if not file.exists():
            continue
        for line in file.read_text().splitlines():
            match = IMAGE_LINE.match(line)
            if match:
                images.append(match.group("image"))
    return sorted(set(images))


def forbidden_members(members: list[str]) -> list[str]:
    matches: list[str] = []
    for member in members:
        normalized = member
        if normalized.startswith("./"):
            normalized = normalized[2:]
        for pattern in FORBIDDEN_IMAGE_PATTERNS:
            if pattern.search(normalized):
                matches.append(normalized)
                break
    return sorted(set(matches))


def inspect_image(image: str) -> list[str]:
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "image.tar"
        pull = subprocess.run(
            ["docker", "image", "pull", image],
            text=True,
            capture_output=True,
            check=False,
        )
        if pull.returncode != 0:
            sys.stderr.write(pull.stderr)
            raise SystemExit(pull.returncode)
        result = subprocess.run(
            ["docker", "image", "save", image, "-o", str(archive)],
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            sys.stderr.write(result.stderr)
            raise SystemExit(result.returncode)
        members: list[str] = []
        with tarfile.open(archive) as outer:
            for outer_member in outer.getmembers():
                if not outer_member.name.endswith(".tar"):
                    continue
                layer = outer.extractfile(outer_member)
                if layer is None:
                    continue
                with tarfile.open(fileobj=layer) as layer_tar:
                    members.extend(member.name for member in layer_tar.getmembers())
        return forbidden_members(members)


def runtime_images_from_env() -> list[str]:
    raw = os.environ.get("GANTRY_RUNTIME_IMAGES", "")
    return [item.strip() for item in raw.split(",") if item.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check runtime image digest pins and forbidden image contents."
    )
    parser.add_argument(
        "--compose",
        action="append",
        default=[],
        help="Compose file to scan for digest-pinned image references.",
    )
    parser.add_argument(
        "--image",
        action="append",
        default=[],
        help="Runtime image to inspect for forbidden paths.",
    )
    parser.add_argument(
        "--inspect-compose-images",
        action="store_true",
        help="Inspect digest-pinned images discovered in compose files.",
    )
    parser.add_argument(
        "--require-content-inspection",
        action="store_true",
        help="Fail when no image or member content was inspected.",
    )
    parser.add_argument(
        "--members",
        help="Test hook: newline-delimited image member paths to check.",
    )
    args = parser.parse_args()

    compose_files = [Path(path) for path in args.compose]
    if not compose_files:
        compose_files = sorted(Path(".").glob("docker-compose*.yml"))
    digest_violations = compose_image_violations(compose_files)
    if digest_violations:
        print("Mutable image references detected:")
        for violation in digest_violations:
            print(f"- {violation}")
        return 1

    if args.members is not None:
        content_failures = forbidden_members(args.members.splitlines())
        if content_failures:
            print("Forbidden runtime image contents detected:")
            for path in content_failures:
                print(f"- {path}")
            return 1
        print("Runtime image gate passed.")
        return 0

    images = [*args.image, *runtime_images_from_env()]
    if args.inspect_compose_images:
        images.extend(compose_images(compose_files))
    images = sorted(set(images))
    for image in images:
        failures = inspect_image(image)
        if failures:
            print(f"Forbidden runtime image contents detected in {image}:")
            for path in failures:
                print(f"- {path}")
            return 1

    if not images:
        if args.require_content_inspection:
            print("No runtime images configured for content inspection.")
            return 1
        print("Runtime image digest gate passed. No runtime images configured for content inspection.")
    else:
        print("Runtime image gate passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
