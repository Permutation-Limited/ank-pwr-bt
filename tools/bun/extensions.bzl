"""Module extension that downloads a prebuilt Bun binary for the host platform."""

_SHA256 = {
    "1.4.4": {
        "darwin-aarch64": "c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510",
        "darwin-x64": "50a3491f73abc2fe81673171a85762d3bc2cc1680ccecadd983de99adf77977e",
        "linux-aarch64": "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e",
        "linux-x64": "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c",
    },
}

def _host_platform(rctx):
    os = rctx.os.name.lower()
    arch = rctx.os.arch.lower()
    if os.startswith("mac"):
        os = "darwin"
    elif os.startswith("linux"):
        os = "linux"
    else:
        fail("Unsupported host OS for bun: " + os)
    if arch in ("aarch64", "arm64"):
        arch = "aarch64"
    elif arch in ("x86_64", "amd64"):
        arch = "x64"
    else:
        fail("Unsupported host arch for bun: " + arch)
    return os + "-" + arch

def _bun_repo_impl(rctx):
    platform = _host_platform(rctx)
    version = rctx.attr.version
    if version not in _SHA256:
        fail("No checksums recorded for bun " + version)
    rctx.download_and_extract(
        url = "https://github.com/oven-sh/bun/releases/download/bun-v{v}/bun-{p}.zip".format(v = version, p = platform),
        sha256 = _SHA256[version][platform],
        stripPrefix = "bun-" + platform,
    )
    rctx.file("BUILD.bazel", """
package(default_visibility = ["//visibility:public"])
exports_files(["bun"])
""")

bun_repo = repository_rule(
    implementation = _bun_repo_impl,
    attrs = {"version": attr.string(mandatory = True)},
)

def _bun_ext_impl(mctx):
    version = None
    for mod in mctx.modules:
        for tc in mod.tags.toolchain:
            version = version or tc.version
    bun_repo(name = "bun", version = version or "1.4.4")

bun = module_extension(
    implementation = _bun_ext_impl,
    tag_classes = {"toolchain": tag_class(attrs = {"version": attr.string()})},
)
