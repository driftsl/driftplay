<script lang="ts">
    import { onMount } from "svelte";
    import init, { compile } from "./wasm/driftc.js";
    import { hash as driftcHash } from "./wasm/meta.js";
    import logo from "./assets/logo.svg";
    import githubLogo from "./assets/github.svg";

    const exampleShaders = [
        {
            name: "Grayscale",
            source: `import { dot } from "@drift/math";

shader Grayscale {
    props {
        texture: sampler2d;
    }

    fragment (uv: vec2) -> color {
        const weights: vec3 = vec3(0.299, 0.587, 0.114);

        let sample = texture.sample(uv);
        let gray = dot(sample.rgb, weights);
        return color(gray, gray, gray, sample.a);
    }
}`,
        },
        {
            name: "Tritanopia",
            source: `import { dot } from "@drift/math";

shader Tritanopia {
    props {
        texture: sampler2d;
    }

    fragment (uv: vec2) -> color {
        const r_weights: vec3 = vec3(0.950, 0.050, 0.0);
        const g_weights: vec3 = vec3(0.000, 0.433, 0.567);
        const b_weights: vec3 = vec3(0.000, 0.475, 0.525);

        let sample = texture.sample(uv);

        return color(
            dot(sample.rgb, r_weights),
            dot(sample.rgb, g_weights),
            dot(sample.rgb, b_weights),
            sample.a
        );
    }
}`,
        },
        {
            name: "Original",
            source: `shader Original {
    props {
        texture: sampler2d;
    }

    fragment (uv: vec2) -> color {
        return texture.sample(uv);
    }
}`,
        },
        {
            name: "Debug UV",
            source: `shader DebugUV {
    fragment (uv: vec2) -> color {
        return vec4(uv.x, uv.y, 0, 1);
    }
}`,
        },
    ];

    let inputShader = $state(exampleShaders[0].source);
    let timeout: number;
    let status = $state("Loading...");
    let outShader = $state("");
    let canvas = $state<HTMLCanvasElement>();
    let ctx: WebGLRenderingContext;
    let wasmReady = false;
    let texture: WebGLTexture | null = null;

    const vertexSrc = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    v_uv.y = 1.0 - v_uv.y;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

    function compileGlShader(type: number, src: string): WebGLShader | null {
        const shader = ctx.createShader(type)!;
        ctx.shaderSource(shader, src);
        ctx.compileShader(shader);
        if (!ctx.getShaderParameter(shader, ctx.COMPILE_STATUS)) {
            outShader +=
                "\n\n// Shader compile error:\n// " +
                ctx.getShaderInfoLog(shader);
            ctx.deleteShader(shader);
            return null;
        }
        return shader;
    }

    function render(fragmentSrc: string) {
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas!.getBoundingClientRect();
        const displayWidth = Math.round(rect.width * dpr);
        const displayHeight = Math.round(rect.height * dpr);

        if (
            canvas!.width !== displayWidth ||
            canvas!.height !== displayHeight
        ) {
            canvas!.width = displayWidth;
            canvas!.height = displayHeight;
        }

        const vs = compileGlShader(ctx.VERTEX_SHADER, vertexSrc);
        const fs = compileGlShader(ctx.FRAGMENT_SHADER, fragmentSrc);
        if (!vs || !fs) return;

        const program = ctx.createProgram()!;
        ctx.attachShader(program, vs);
        ctx.attachShader(program, fs);
        ctx.linkProgram(program);
        if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
            outShader +=
                "\n\n// Link error:\n// " + ctx.getProgramInfoLog(program);
            return;
        }
        ctx.useProgram(program);

        if (texture) {
            ctx.activeTexture(ctx.TEXTURE0);
            ctx.bindTexture(ctx.TEXTURE_2D, texture);

            const texLoc = ctx.getUniformLocation(program, "u_texture");
            if (texLoc !== null) {
                ctx.uniform1i(texLoc, 0);
            }
        }

        const vertices = new Float32Array([
            -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
        ]);
        const buffer = ctx.createBuffer();
        ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
        ctx.bufferData(ctx.ARRAY_BUFFER, vertices, ctx.STATIC_DRAW);

        const posLoc = ctx.getAttribLocation(program, "a_position");
        ctx.enableVertexAttribArray(posLoc);
        ctx.vertexAttribPointer(posLoc, 2, ctx.FLOAT, false, 0, 0);

        ctx.viewport(0, 0, canvas!.width, canvas!.height);
        ctx.clearColor(0, 0, 0, 1);
        ctx.clear(ctx.COLOR_BUFFER_BIT);
        ctx.drawArrays(ctx.TRIANGLES, 0, 6);
    }

    function recompile() {
        if (!wasmReady) return;
        if (ctx == null) {
            outShader = "WebGL is not supported in your browser.";
            return;
        }
        const start = performance.now();
        try {
            const glsl = compile(inputShader);
            const time = performance.now() - start;
            status = `Compilation successfull in ${Math.round(time * 10) / 10}ms`;
            outShader = glsl;
            render(glsl);
        } catch (e) {
            status = "Error";
            outShader = String(e);
        }
    }

    onMount(async () => {
        ctx = canvas!.getContext("webgl")!;

        const img = new Image();
        img.src = "/test-texture.png";
        img.onload = () => {
            texture = ctx.createTexture();
            ctx.bindTexture(ctx.TEXTURE_2D, texture);

            ctx.texParameteri(
                ctx.TEXTURE_2D,
                ctx.TEXTURE_WRAP_S,
                ctx.CLAMP_TO_EDGE,
            );
            ctx.texParameteri(
                ctx.TEXTURE_2D,
                ctx.TEXTURE_WRAP_T,
                ctx.CLAMP_TO_EDGE,
            );
            ctx.texParameteri(
                ctx.TEXTURE_2D,
                ctx.TEXTURE_MIN_FILTER,
                ctx.LINEAR,
            );
            ctx.texParameteri(
                ctx.TEXTURE_2D,
                ctx.TEXTURE_MAG_FILTER,
                ctx.LINEAR,
            );

            ctx.texImage2D(
                ctx.TEXTURE_2D,
                0,
                ctx.RGBA,
                ctx.RGBA,
                ctx.UNSIGNED_BYTE,
                img,
            );

            if (wasmReady) {
                recompile();
            }
        };

        await init();
        wasmReady = true;
        recompile();
    });

    $effect(() => {
        inputShader;
        clearTimeout(timeout);
        timeout = setTimeout(recompile, 150);
    });
</script>

<div class="wrapper">
    <header>
        <a href="/" class="logo">
            <img alt="logo" src={logo} />
        </a>

        <div class="right">
            <span class="version">driftc {driftcHash.substring(0, 7)}</span>
            <a title="driftc github" href="https://github.com/driftsl/driftc">
                <img alt="github" src={githubLogo} />
            </a>
        </div>
    </header>
    <main>
        <div class="inputs">
            <div>
                <div class="header">
                    <span>Input:</span>
                    <div class="buttons">
                        {#each exampleShaders as { name, source }}
                            <button
                                onclick={() => {
                                    inputShader = source;
                                    recompile();
                                }}
                            >
                                {name} example
                            </button>
                        {/each}
                    </div>
                </div>
                <textarea id="input" bind:value={inputShader}></textarea>
            </div>
            <div>
                <span>{status}:</span>
                <textarea id="generated" readonly value={outShader}></textarea>
            </div>
        </div>
        <div class="output">
            <canvas bind:this={canvas}></canvas>
        </div>
    </main>
</div>

<style lang="scss">
    .wrapper {
        height: 100vh;

        padding: 16px;

        display: flex;
        flex-direction: column;
        gap: 8px;

        box-sizing: border-box;
    }

    header {
        height: 20px;

        display: flex;
        justify-content: space-between;
        align-items: center;

        > .logo {
            height: 100%;

            transition: opacity 0.2s ease;

            &:active {
                opacity: 0.5;
            }

            > img {
                height: 100%;
            }
        }

        > .right {
            opacity: 0.5;

            display: flex;
            gap: 8px;

            > a {
                display: flex;
            }

            img {
                width: 18px;
                aspect-ratio: 1;
            }
        }
    }

    main {
        flex-grow: 1;

        display: grid;
        grid-template-columns: 3fr 2fr;
        gap: 16px;

        > .inputs {
            display: grid;
            grid-template-rows: 1fr 1fr;
            gap: 8px;

            > * {
                display: flex;
                flex-direction: column;
                gap: 4px;

                > .header {
                    display: flex;
                    gap: 16px;
                    align-items: center;

                    > .buttons {
                        display: flex;
                        gap: 4px;
                        flex-grow: 1;
                    }
                }

                > textarea {
                    flex-grow: 1;
                }
            }
        }

        > .output {
            display: flex;
            justify-content: center;
            align-items: center;

            > canvas {
                width: 100%;
                aspect-ratio: 1;
                border: 1px solid #323232;
            }
        }
    }

    textarea {
        all: unset;

        font-family: "JetBrains Mono Variable", monospace;

        white-space: pre-wrap;

        background-color: #202020;
        border: 1px solid #323232;
        padding: 4px;
    }
</style>
