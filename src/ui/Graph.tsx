import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
} from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import type { Graph as GraphData, Note, Agent } from "../shared/types";
import { colors } from "./api";

type Node = Note &
  SimulationNodeDatum & { radius: number; homeX: number; homeY: number };
export type GraphControls = { fit: () => void; zoom: (factor: number) => void };
type Props = {
  graph: GraphData;
  agents: Agent[];
  selected?: string;
  query: string;
  domain?: string;
  motion: boolean;
  labels: boolean;
  onSelect: (note: Note) => void;
  onAgent: (id: string) => void;
};
export const BrainGraph = forwardRef<GraphControls, Props>(
  function BrainGraph(props, ref) {
    const canvas = useRef<HTMLCanvasElement>(null);
    const latest = useRef(props);
    latest.current = props;
    const nodes = useRef<Node[]>([]);
    const sim = useRef<ReturnType<typeof forceSimulation<Node>> | null>(null);
    const view = useRef({
      x: 0,
      y: 0,
      scale: 1,
      targetScale: 1,
      width: 800,
      height: 600,
    });
    const [hover, setHover] = useState<{
      title: string;
      x: number;
      y: number;
      domain: string;
    } | null>(null);
    const fit = () => {
      const v = view.current;
      const ns = nodes.current;
      if (!ns.length) return;
      const xs = ns.map((n) => n.x || 0),
        ys = ns.map((n) => n.y || 0);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys);
      v.targetScale = Math.min(
        1.45,
        (v.width - 100) / (maxX - minX + 100),
        (v.height - 75) / (maxY - minY + 75),
      );
      v.x = (-(maxX + minX) / 2) * v.targetScale;
      v.y = (-(maxY + minY) / 2) * v.targetScale;
    };
    useImperativeHandle(ref, () => ({
      fit,
      zoom: (factor) => {
        view.current.targetScale = Math.max(
          0.25,
          Math.min(3.5, view.current.targetScale * factor),
        );
      },
    }));
    useEffect(() => {
      const old = new Map(nodes.current.map((n) => [n.id, n]));
      const domains = [...new Set(props.graph.nodes.map((n) => n.domain))];
      const degree = new Map<string, number>();
      for (const l of props.graph.links) {
        degree.set(l.source, (degree.get(l.source) || 0) + 1);
        degree.set(l.target, (degree.get(l.target) || 0) + 1);
      }
      const ns: Node[] = props.graph.nodes.map((note, i) => {
        const angle =
          (domains.indexOf(note.domain) / Math.max(domains.length, 1)) *
            Math.PI *
            2 -
          Math.PI / 2;
        const centers: Record<string, [number, number]> = {
          company: [80, -130],
          operations: [-270, -55],
          relay: [210, 120],
          agentview: [310, -160],
          aegis: [-180, 160],
          website: [-340, 115],
          "discord-bot": [-80, 190],
          gamehealth: [-360, -170],
          faultlab: [60, 200],
        };
        const center = centers[note.domain] || [
          Math.cos(angle) * 270,
          Math.sin(angle) * 130,
        ];
        const homeX = center[0] + Math.cos(i * 2.399) * 110;
        const homeY = center[1] + Math.sin(i * 2.399) * 65;
        const retained = old.get(note.id);
        return {
          ...note,
          radius: Math.min(13, 4.2 + Math.sqrt(degree.get(note.id) || 0) * 1.9),
          homeX,
          homeY,
          x: retained?.x ?? homeX + Math.cos(i * 2.399) * 80,
          y: retained?.y ?? homeY + Math.sin(i * 2.399) * 80,
          vx: retained?.vx || 0,
          vy: retained?.vy || 0,
        };
      });
      nodes.current = ns;
      sim.current?.stop();
      sim.current = forceSimulation(ns)
        .force(
          "link",
          forceLink<Node, any>(props.graph.links.map((l) => ({ ...l })))
            .id((n) => n.id)
            .distance(110)
            .strength(0.07),
        )
        .force("charge", forceManyBody().strength(-190))
        .force(
          "collide",
          forceCollide<Node>()
            .radius((n) => n.radius + 25)
            .strength(0.75),
        )
        .force("x", forceX<Node>((n) => n.homeX).strength(0.1))
        .force("y", forceY<Node>((n) => n.homeY).strength(0.065))
        .velocityDecay(0.26)
        .alpha(0.7)
        .alphaTarget(0.012);
      if (!old.size) {
        sim.current.stop().tick(100).restart();
        const timer = setTimeout(fit, 150);
        return () => clearTimeout(timer);
      }
    }, [props.graph]);
    useEffect(() => {
      const c = canvas.current!;
      const ctx = c.getContext("2d")!;
      let frame = 0;
      let dragging: Node | null = null;
      let pan = false;
      let moved = false;
      let down = { x: 0, y: 0 };
      let hovered: string | undefined;
      const orbPositions = new Map<string, { x: number; y: number }>();
      let orbHits: { id: string; x: number; y: number }[] = [];
      const resize = new ResizeObserver(([entry]) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        c.width = entry.contentRect.width * dpr;
        c.height = entry.contentRect.height * dpr;
        view.current.width = entry.contentRect.width;
        view.current.height = entry.contentRect.height;
      });
      resize.observe(c);
      const local = (e: PointerEvent) => {
        const rect = c.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      };
      const world = (p: { x: number; y: number }) => {
        const v = view.current;
        return {
          x: (p.x - v.width / 2 - v.x) / v.scale,
          y: (p.y - v.height / 2 - v.y) / v.scale,
        };
      };
      const hit = (p: { x: number; y: number }) =>
        nodes.current.find(
          (n) =>
            Math.hypot((n.x || 0) - p.x, (n.y || 0) - p.y) <
            n.radius + 10 / view.current.scale,
        );
      const pointerdown = (e: PointerEvent) => {
        const p = local(e);
        const orb = orbHits.find((a) => Math.hypot(a.x - p.x, a.y - p.y) < 20);
        if (orb) {
          latest.current.onAgent(orb.id);
          return;
        }
        down = p;
        moved = false;
        dragging = hit(world(p)) || null;
        pan = !dragging;
        c.setPointerCapture(e.pointerId);
        c.style.cursor = "grabbing";
        if (dragging) {
          dragging.fx = dragging.x;
          dragging.fy = dragging.y;
          sim.current?.alphaTarget(0.15).restart();
        }
      };
      const pointermove = (e: PointerEvent) => {
        const p = local(e);
        const w = world(p);
        if (dragging || pan) {
          if (Math.hypot(p.x - down.x, p.y - down.y) > 2) moved = true;
          if (dragging) {
            dragging.fx = w.x;
            dragging.fy = w.y;
          } else {
            view.current.x += p.x - down.x;
            view.current.y += p.y - down.y;
          }
          down = p;
          setHover(null);
          return;
        }
        const node = hit(w);
        hovered = node?.id;
        c.style.cursor =
          node || orbHits.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < 20)
            ? "pointer"
            : "grab";
        setHover(
          node
            ? {
                title: node.title,
                domain: node.domain,
                x: Math.min(p.x + 16, view.current.width - 230),
                y: p.y - 40,
              }
            : null,
        );
      };
      const pointerup = () => {
        if (dragging) {
          if (!moved) latest.current.onSelect(dragging);
          dragging.fx = null;
          dragging.fy = null;
          sim.current?.alphaTarget(0.012);
        }
        dragging = null;
        pan = false;
        c.style.cursor = "grab";
      };
      const wheel = (e: WheelEvent) => {
        e.preventDefault();
        view.current.targetScale = Math.max(
          0.25,
          Math.min(
            3.5,
            view.current.targetScale * Math.exp(-e.deltaY * 0.0012),
          ),
        );
      };
      const dblclick = () => fit();
      c.addEventListener("pointerdown", pointerdown);
      c.addEventListener("pointermove", pointermove);
      c.addEventListener("pointerup", pointerup);
      c.addEventListener("pointercancel", pointerup);
      c.addEventListener("wheel", wheel, { passive: false });
      c.addEventListener("dblclick", dblclick);
      const draw = (time: number) => {
        const v = view.current;
        const p = latest.current;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        v.scale += (v.targetScale - v.scale) * 0.12;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, v.width, v.height);
        const t = p.motion ? time / 1000 : 0;
        // A quiet star field gives the network depth without competing with the notes.
        for (let i = 0; i < 65; i++) {
          const x =
            ((((Math.sin(i * 127.1) * 43758.5453) % 1) + 1) % 1) * v.width;
          const y =
            ((((Math.sin(i * 311.7) * 19341.315) % 1) + 1) % 1) * v.height;
          ctx.fillStyle = `rgba(167,192,205,${0.035 + (Math.sin(t * 0.3 + i) + 1) * 0.018})`;
          ctx.beginPath();
          ctx.arc(x, y, i % 9 === 0 ? 1.2 : 0.65, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.save();
        ctx.translate(v.width / 2 + v.x, v.height / 2 + v.y);
        ctx.scale(v.scale, v.scale);
        const map = new Map(nodes.current.map((n) => [n.id, n]));
        const isMatch = (n: Node) =>
          (!p.domain || p.domain === n.domain) &&
          (!p.query ||
            `${n.title} ${n.id}`.toLowerCase().includes(p.query.toLowerCase()));
        const focus = p.selected || hovered;
        const neighbors = new Set<string>();
        if (focus)
          for (const l of p.graph.links) {
            if (l.source === focus) neighbors.add(l.target);
            if (l.target === focus) neighbors.add(l.source);
          }
        for (const l of p.graph.links) {
          const a = map.get(l.source),
            b = map.get(l.target);
          if (!a || !b) continue;
          const lit = l.source === focus || l.target === focus;
          ctx.strokeStyle = lit
            ? "rgba(139,219,196,.42)"
            : isMatch(a) && isMatch(b)
              ? "rgba(133,163,177,.115)"
              : "rgba(133,163,177,.025)";
          ctx.lineWidth = (lit ? 1.2 : 0.7) / v.scale;
          ctx.beginPath();
          ctx.moveTo(a.x!, a.y!);
          ctx.lineTo(b.x!, b.y!);
          ctx.stroke();
        }
        const labelBoxes: { x: number; y: number; w: number; h: number }[] = [];
        const ordered = [...nodes.current].sort((a, b) => b.radius - a.radius);
        for (let i = 0; i < ordered.length; i++) {
          const n = ordered[i];
          const color = colors[n.domain] || colors.knowledge;
          const match = isMatch(n);
          const selected = n.id === focus;
          const x = n.x || 0,
            y = n.y || 0;
          const pulse = 1 + Math.sin(t * 0.9 + i * 2) * 0.08;
          ctx.globalAlpha = match ? 1 : 0.13;
          if (p.motion && !dragging && sim.current) {
            n.vx = (n.vx || 0) + Math.sin(t * 0.6 + i * 3) * 0.012;
            n.vy = (n.vy || 0) + Math.cos(t * 0.5 + i * 2) * 0.012;
          }
          const glow = ctx.createRadialGradient(
            x,
            y,
            0,
            x,
            y,
            n.radius * (selected ? 6 : 4),
          );
          glow.addColorStop(0, color + (selected ? "45" : "22"));
          glow.addColorStop(1, color + "00");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, n.radius * (selected ? 6 : 4), 0, Math.PI * 2);
          ctx.fill();
          if (selected) {
            ctx.strokeStyle = color + "85";
            ctx.lineWidth = 1 / v.scale;
            ctx.beginPath();
            ctx.arc(x, y, n.radius + 7 + pulse, 0, Math.PI * 2);
            ctx.stroke();
          }
          const changed = Date.now() - n.modified;
          if (p.motion && changed >= 0 && changed < 5000) {
            ctx.strokeStyle =
              color +
              Math.round((1 - changed / 5000) * 120)
                .toString(16)
                .padStart(2, "0");
            ctx.lineWidth = 1.5 / v.scale;
            ctx.beginPath();
            ctx.arc(x, y, n.radius + changed / 180, 0, Math.PI * 2);
            ctx.stroke();
          }
          const ball = ctx.createRadialGradient(
            x - n.radius * 0.3,
            y - n.radius * 0.4,
            0.1,
            x,
            y,
            n.radius,
          );
          ball.addColorStop(0, "#e7f8f2");
          ball.addColorStop(0.3, color);
          ball.addColorStop(1, color + "85");
          ctx.fillStyle = ball;
          ctx.beginPath();
          ctx.arc(x, y, n.radius * pulse, 0, Math.PI * 2);
          ctx.fill();
          if (p.labels || selected || neighbors.has(n.id) || p.query) {
            const major = n.kind === "entry" || n.kind === "hub";
            ctx.font = `${selected || major ? "500" : "400"} ${major ? 12 : 10.5}px "DM Sans", "Segoe UI", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = selected
              ? "#f3faf7"
              : major
                ? "#b8c8cd"
                : "#7f969f";
            const label =
              n.title.length > 28 ? n.title.slice(0, 26) + "…" : n.title;
            const width = ctx.measureText(label).width;
            const box = {
              x: x - width / 2,
              y: y + n.radius + 9,
              w: width,
              h: 13,
            };
            if (
              selected ||
              !labelBoxes.some(
                (b) =>
                  box.x < b.x + b.w + 3 &&
                  box.x + box.w + 3 > b.x &&
                  box.y < b.y + b.h + 3 &&
                  box.y + box.h + 3 > b.y,
              )
            ) {
              ctx.fillText(label, x, y + n.radius + 9);
              labelBoxes.push(box);
            }
          }
        }
        ctx.globalAlpha = 1;
        orbHits = [];
        const agents = p.agents.filter(
          (a) => a.active || Date.now() - a.updated < 15000,
        );
        agents.forEach((a, i) => {
          const target = a.target && map.get(a.target);
          const theta = t * 0.33 + i * 2.4;
          const dest = target
            ? {
                x: target.x! + Math.cos(theta) * 25,
                y: target.y! + Math.sin(theta) * 25,
              }
            : {
                x: Math.cos(theta) * (90 + i * 32),
                y: Math.sin(theta * 0.8) * (65 + i * 24),
              };
          const pos = orbPositions.get(a.id) || { x: 0, y: 0 };
          pos.x += (dest.x - pos.x) * 0.035;
          pos.y += (dest.y - pos.y) * 0.035;
          orbPositions.set(a.id, pos);
          const color = a.parentId ? "#c4acff" : "#b3ffe1";
          const radius = a.parentId ? 5 : 7;
          const glow = ctx.createRadialGradient(
            pos.x,
            pos.y,
            0,
            pos.x,
            pos.y,
            33,
          );
          glow.addColorStop(0, color + "b0");
          glow.addColorStop(0.23, color + "40");
          glow.addColorStop(1, color + "00");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 33, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowColor = color;
          ctx.shadowBlur = 16;
          ctx.fillStyle = "#f3fff9";
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          if (target) {
            ctx.strokeStyle = color + "55";
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(target.x!, target.y!);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          ctx.font = '500 10px Inter, "Segoe UI", sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.fillText(`${a.name} · ${a.action}`, pos.x, pos.y + 20);
          orbHits.push({
            id: a.threadId,
            x: pos.x * v.scale + v.width / 2 + v.x,
            y: pos.y * v.scale + v.height / 2 + v.y,
          });
        });
        ctx.restore();
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
      return () => {
        cancelAnimationFrame(frame);
        resize.disconnect();
        c.removeEventListener("pointerdown", pointerdown);
        c.removeEventListener("pointermove", pointermove);
        c.removeEventListener("pointerup", pointerup);
        c.removeEventListener("pointercancel", pointerup);
        c.removeEventListener("wheel", wheel);
        c.removeEventListener("dblclick", dblclick);
        sim.current?.stop();
      };
    }, []);
    return (
      <div className="graph-surface">
        <canvas
          ref={canvas}
          aria-label="Interactive knowledge graph. Drag notes to move them, scroll to zoom, double-click to fit."
        />
        <div className="graph-vignette" />
        {hover && (
          <div
            className="graph-tooltip"
            style={{ left: hover.x, top: hover.y }}
          >
            <span style={{ background: colors[hover.domain] }} />
            {hover.title}
          </div>
        )}
      </div>
    );
  },
);
