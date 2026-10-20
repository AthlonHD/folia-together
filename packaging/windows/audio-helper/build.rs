// Builds libsoxr (the SoX resampler, LGPL-2.1) from the sources in vendor/soxr, statically, with its 64-bit engine on: the engine soxr
// itself uses for its highest quality settings. Without SIMD, which keeps the build to plain C that every compiler takes.
fn main() {
    let mut build = cc::Build::new();
    build.include("vendor/soxr").define("SOXR_LIB", "0").warnings(false);
    for source in [
        "soxr.c", "data-io.c", "dbesi0.c", "filter.c", "cr.c", "cr32.c", "cr64.c", "fft4g.c", "fft4g32.c", "fft4g64.c", "vr32.c",
    ] {
        build.file(format!("vendor/soxr/{source}"));
    }
    build.compile("soxr");
    println!("cargo:rerun-if-changed=vendor/soxr");
}
