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
import { colors, browser } from "./api";
import { moveToward } from "./motion";

type Node = Note &
  SimulationNodeDatum & { radius: number; homeX: number; homeY: number };
type Station = {
  id: string;
  title: string;
  symbol: string;
  color: string;
  x: number;
  y: number;
  placed: boolean;
};
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
    const sceneCanvas = useRef<HTMLCanvasElement>(null);
    const latest = useRef(props);
    latest.current = props;
    const nodes = useRef<Node[]>([]);
    const drawing = useRef({
      map: new Map<string, Node>(),
      ordered: [] as Node[],
    });
    const visible = useRef(!browser);
    const layoutKey = useRef("");
    const invalidate = useRef(() => {});
    const stations = useRef<Station[]>([
      {
        id: "terminal",
        title: "Terminal",
        symbol: ">_",
        color: "#e6bc78",
        x: 0,
        y: 0,
        placed: false,
      },
      {
        id: "workspace",
        title: "Agent workspace",
        symbol: "✦",
        color: "#b3ffe1",
        x: 0,
        y: 0,
        placed: false,
      },
    ]);
    const positionStations = () => {
      const ns = nodes.current;
      const left = Math.min(0, ...ns.map((n) => (n.x ?? 0) - n.radius));
      const right = Math.max(0, ...ns.map((n) => (n.x ?? 0) + n.radius));
      const bottom = Math.max(0, ...ns.map((n) => (n.y ?? 0) + n.radius));
      stations.current.forEach((station, i) => {
        if (station.placed) return;
        station.x = (left + right) / 2 + (i ? 90 : -90);
        station.y = bottom + 100;
      });
    };
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
      if (!ns.length || v.width <= 100 || v.height <= 75) return;
      const xs = ns.map((n) => n.x || 0),
        ys = ns.map((n) => n.y || 0);
      if (browser) {
        positionStations();
        for (const station of stations.current) {
          xs.push(station.x - 55, station.x + 55);
          ys.push(station.y + 45);
        }
      }
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
      invalidate.current();
    };
    useImperativeHandle(ref, () => ({
      fit,
      zoom: (factor) => {
        view.current.targetScale = Math.max(
          0.25,
          Math.min(3.5, view.current.targetScale * factor),
        );
        invalidate.current();
      },
    }));
    useEffect(() => {
      const old = new Map(nodes.current.map((n) => [n.id, n]));
      const nextLayoutKey = JSON.stringify([
        props.graph.nodes.map((n) => [n.id, n.domain]),
        props.graph.links,
      ]);
      const retainLayout =
        browser && nextLayoutKey === layoutKey.current && sim.current;
      layoutKey.current = nextLayoutKey;
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
        };
        const center = centers[note.domain] || [
          Math.cos(angle) * 270,
          Math.sin(angle) * 130,
        ];
        const homeX = center[0] + Math.cos(i * 2.399) * 110;
        const homeY = center[1] + Math.sin(i * 2.399) * 65;
        const retained = old.get(note.id);
        if (retainLayout && retained) return Object.assign(retained, note);
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
      drawing.current = {
        map: new Map(ns.map((node) => [node.id, node])),
        ordered: [...ns].sort((a, b) => b.radius - a.radius),
      };
      if (retainLayout) {
        invalidate.current();
        return;
      }
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
        .alphaTarget(0)
        .on("tick.draw", () => invalidate.current())
        .on("end.draw", () => invalidate.current());
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (!old.size) {
        sim.current.stop().tick(100).restart();
        timer = setTimeout(fit, 150);
      }
      if (browser && !visible.current) sim.current.stop();
      invalidate.current();
      return () => clearTimeout(timer);
    }, [props.graph]);
    useEffect(() => {
      invalidate.current();
    }, [
      props.agents,
      props.selected,
      props.query,
      props.domain,
      props.motion,
      props.labels,
    ]);
    useEffect(() => {
      const c = canvas.current!;
      const screen = c.getContext("2d")!;
      // The settled note network is one reusable raster. Live agents can move
      // over it without repainting every link and label on every frame.
      const scene = browser ? sceneCanvas.current! : undefined;
      const sceneContext = scene?.getContext("2d");
      let ctx = screen;
      let sceneDirty = true;
      let frame = 0;
      let lastTime = 0;
      const textWidths = new Map<string, number>();
      const requestDraw = (dirty = true) => {
        sceneDirty ||= dirty;
        if (!frame && (!browser || visible.current))
          frame = requestAnimationFrame(draw);
      };
      invalidate.current = requestDraw;
      const updateVisibility = () => {
        if (!browser) return;
        visible.current =
          !document.hidden && c.clientWidth > 0 && c.clientHeight > 0;
        if (!visible.current) {
          cancelAnimationFrame(frame);
          frame = 0;
          lastTime = 0;
          if (dragging) {
            dragging.fx = null;
            dragging.fy = null;
          }
          dragging = null;
          draggingStation = null;
          pan = false;
          moved = true;
          pointers.clear();
          hovered = undefined;
          setHover(null);
          sim.current?.alphaTarget(0).stop();
        } else {
          if (sim.current && sim.current.alpha() >= sim.current.alphaMin())
            sim.current.restart();
          requestDraw();
        }
      };
      let dragging: Node | null = null;
      let draggingStation: Station | null = null;
      let stationOffset = { x: 0, y: 0 };
      let pan = false;
      let moved = false;
      let down = { x: 0, y: 0 };
      let press = { x: 0, y: 0 };
      let hovered: string | undefined;
      const orbPositions = new Map<string, { x: number; y: number }>();
      const connections = new Map<
        string,
        { target: string; progress: number }
      >();
      let orbHits: { id: string; x: number; y: number }[] = [];
      const resize = new ResizeObserver(([entry]) => {
        updateVisibility();
        if (entry.contentRect.width <= 0 || entry.contentRect.height <= 0)
          return;
        const dpr = window.devicePixelRatio || 1;
        if (
          browser &&
          view.current.width === entry.contentRect.width &&
          view.current.height === entry.contentRect.height &&
          c.width === Math.round(entry.contentRect.width * dpr) &&
          c.height === Math.round(entry.contentRect.height * dpr)
        )
          return;
        c.width = Math.round(entry.contentRect.width * dpr);
        c.height = Math.round(entry.contentRect.height * dpr);
        view.current.width = entry.contentRect.width;
        view.current.height = entry.contentRect.height;
        fit();
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
      const hitStation = (p: { x: number; y: number }) =>
        browser
          ? stations.current.find(
              (s) =>
                Math.hypot(s.x - p.x, s.y - p.y) < 13 + 10 / view.current.scale,
            )
          : undefined;
      const pointers = new Map<number, { x: number; y: number }>();
      let pinchDistance = 0;
      const distance = () => {
        const [a, b] = [...pointers.values()];
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
      };
      const pointerdown = (e: PointerEvent) => {
        requestDraw();
        const p = local(e);
        pointers.set(e.pointerId, p);
        c.setPointerCapture(e.pointerId);
        if (pointers.size > 1) {
          if (dragging) {
            dragging.fx = null;
            dragging.fy = null;
            sim.current?.alphaTarget(0);
          }
          dragging = null;
          draggingStation = null;
          pan = false;
          moved = true;
          pinchDistance = distance();
          return;
        }
        const w = world(p);
        draggingStation = hitStation(w) || null;
        const orb =
          !draggingStation &&
          orbHits.find((a) => Math.hypot(a.x - p.x, a.y - p.y) < 20);
        if (orb) {
          latest.current.onAgent(orb.id);
          return;
        }
        down = p;
        press = p;
        moved = false;
        dragging = draggingStation ? null : hit(w) || null;
        pan = !dragging && !draggingStation;
        if (draggingStation) {
          stationOffset = {
            x: draggingStation.x - w.x,
            y: draggingStation.y - w.y,
          };
        }
        c.setPointerCapture(e.pointerId);
        c.style.cursor = "grabbing";
        if (dragging) {
          dragging.fx = dragging.x;
          dragging.fy = dragging.y;
          sim.current?.alphaTarget(0.15).restart();
        }
      };
      const pointermove = (e: PointerEvent) => {
        requestDraw();
        const p = local(e);
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
        if (pointers.size > 1) {
          const next = distance();
          if (pinchDistance > 0)
            view.current.targetScale = Math.max(
              0.25,
              Math.min(3.5, (view.current.targetScale * next) / pinchDistance),
            );
          pinchDistance = next;
          return;
        }
        const w = world(p);
        if (dragging || draggingStation || pan) {
          if (Math.hypot(p.x - press.x, p.y - press.y) > 4) moved = true;
          if (draggingStation) {
            if (moved) {
              draggingStation.x = w.x + stationOffset.x;
              draggingStation.y = w.y + stationOffset.y;
              draggingStation.placed = true;
            }
          } else if (dragging) {
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
        const station = hitStation(w);
        hovered = node?.id;
        c.style.cursor =
          node ||
          station ||
          orbHits.some((a) => Math.hypot(a.x - p.x, a.y - p.y) < 20)
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
      const pointerup = (e: PointerEvent) => {
        requestDraw();
        pointers.delete(e.pointerId);
        if (e.type === "pointercancel") moved = true;
        if (draggingStation && !moved) {
          const station = draggingStation;
          const busy = latest.current.agents.find(
            (a) =>
              a.active &&
              !a.target &&
              (a.action === "running" ? "terminal" : "workspace") ===
                station.id,
          );
          if (busy) latest.current.onAgent(busy.threadId);
        }
        if (dragging) {
          if (!moved) latest.current.onSelect(dragging);
          dragging.fx = null;
          dragging.fy = null;
          sim.current?.alphaTarget(0);
        }
        dragging = null;
        draggingStation = null;
        pan = false;
        c.style.cursor = "grab";
      };
      const wheel = (e: WheelEvent) => {
        requestDraw();
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
      const pointerleave = () => {
        hovered = undefined;
        setHover(null);
        requestDraw();
      };
      c.addEventListener("pointerdown", pointerdown);
      c.addEventListener("pointermove", pointermove);
      c.addEventListener("pointerup", pointerup);
      c.addEventListener("pointercancel", pointerup);
      c.addEventListener("pointerleave", pointerleave);
      c.addEventListener("wheel", wheel, { passive: false });
      c.addEventListener("dblclick", dblclick);
      const draw = (time: number) => {
        frame = 0;
        if (browser && !visible.current) return;
        const v = view.current;
        const p = latest.current;
        const dpr = window.devicePixelRatio || 1;
        // A monitor move can change density without changing the CSS canvas size.
        if (
          c.width !== Math.round(v.width * dpr) ||
          c.height !== Math.round(v.height * dpr)
        ) {
          c.width = Math.round(v.width * dpr);
          c.height = Math.round(v.height * dpr);
          sceneDirty = true;
        }
        const seconds = Math.min(
          0.05,
          lastTime ? (time - lastTime) / 1000 : 1 / 60,
        );
        lastTime = time;
        const previousScale = v.scale;
        v.scale += (v.targetScale - v.scale) * (1 - Math.exp(-seconds * 8));
        if (Math.abs(v.targetScale - v.scale) < 0.00001)
          v.scale = v.targetScale;
        if (previousScale !== v.scale) sceneDirty = true;
        const t = p.motion ? time / 1000 : 0;
        const now = Date.now();
        const changing =
          p.motion &&
          nodes.current.some(
            (n) => now >= n.modified && now - n.modified < 5000,
          );
        const { map, ordered } = drawing.current;
        if (scene && (scene.width !== c.width || scene.height !== c.height)) {
          scene.width = c.width;
          scene.height = c.height;
          sceneDirty = true;
        }
        ctx = sceneContext || screen;
        if (!browser || sceneDirty || changing) {
          sceneDirty = false;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, v.width, v.height);
          // A quiet star field gives the network depth without competing with the notes.
          for (let i = 0; !browser && i < 65; i++) {
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
          const query = p.query.toLowerCase();
          const isMatch = (n: Node) =>
            (!p.domain || p.domain === n.domain) &&
            (!p.query || `${n.title} ${n.id}`.toLowerCase().includes(query));
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
          const labelBoxes: { x: number; y: number; w: number; h: number }[] =
            [];
          for (let i = 0; i < ordered.length; i++) {
            const n = ordered[i];
            const color = colors[n.domain] || colors.knowledge;
            const match = isMatch(n);
            const selected = n.id === focus;
            const x = n.x || 0,
              y = n.y || 0;
            const pulse = browser ? 1 : 1 + Math.sin(t * 0.9 + i * 2) * 0.08;
            ctx.globalAlpha = match ? 1 : 0.13;
            if (!browser) {
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
            }
            if (selected) {
              ctx.strokeStyle = color + "85";
              ctx.lineWidth = 1 / v.scale;
              ctx.beginPath();
              ctx.arc(x, y, n.radius + 7 + pulse, 0, Math.PI * 2);
              ctx.stroke();
            }
            const changed = now - n.modified;
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
            if (browser) {
              ctx.fillStyle = color + (selected ? "e6" : "a6");
            } else {
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
            }
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
              const key = `${ctx.font}/${label}`;
              let width = textWidths.get(key);
              if (width === undefined) {
                width = ctx.measureText(label).width;
                // A refreshed vault may introduce new titles over a long session.
                if (textWidths.size >= 4096) textWidths.clear();
                textWidths.set(key, width);
              }
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
          if (browser) ctx.restore();
          // Paint once more when a file pulse expires so its last ring is not
          // retained in the otherwise settled scene.
          sceneDirty = changing;
        }
        if (scene) {
          ctx = screen;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, v.width, v.height);
          ctx.save();
          ctx.translate(v.width / 2 + v.x, v.height / 2 + v.y);
          ctx.scale(v.scale, v.scale);
        }
        orbHits = [];
        const agents = p.agents.filter(
          (a) => a.active || now - a.updated < 15000,
        );
        if (browser) positionStations();
        const renderedStations = stations.current.map((station, i) =>
          browser
            ? station
            : {
                ...station,
                ...world({ x: i ? v.width - 100 : 86, y: v.height - 58 }),
              },
        );
        const stationFor = (a: Agent) =>
          renderedStations[a.action === "running" ? 0 : 1];
        for (const station of renderedStations) {
          const busy = agents.filter(
            (a) => a.active && !a.target && stationFor(a).id === station.id,
          );
          if (busy.length && !browser)
            orbHits.push({
              id: busy[0].threadId,
              x: station.x * v.scale + v.width / 2 + v.x,
              y: station.y * v.scale + v.height / 2 + v.y,
            });
          ctx.save();
          ctx.translate(station.x, station.y);
          if (!browser) ctx.scale(1 / v.scale, 1 / v.scale);
          ctx.fillStyle = browser ? "#0b131a" : "#101e25";
          ctx.strokeStyle = station.color + (busy.length ? "cc" : "45");
          ctx.shadowColor = station.color;
          ctx.shadowBlur =
            busy.length && !browser ? 18 + Math.sin(t * 2) * 4 : 0;
          ctx.lineWidth = 1.3;
          ctx.beginPath();
          if (browser) ctx.arc(0, 0, 13, 0, Math.PI * 2);
          else ctx.roundRect(-25, -22, 50, 44, 13);
          ctx.fill();
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = station.color;
          ctx.font = `600 ${browser ? 11 : 17}px "DM Sans", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(station.symbol, 0, -1);
          ctx.font = '500 11px "DM Sans", sans-serif';
          ctx.fillText(station.title, 0, browser ? 27 : 35);
          if (busy.length) {
            ctx.font = '400 10px "DM Sans", sans-serif';
            ctx.fillText(
              `${busy.length} active · ${busy[0].action}`,
              0,
              browser ? 42 : 50,
            );
          }
          ctx.restore();
        }
        agents.forEach((a, i) => {
          const target = (a.target && map.get(a.target)) || stationFor(a);
          const theta = t * 0.18 + i * 2.4;
          const dest = {
            x: target.x! + (Math.cos(theta) * 38) / v.scale,
            y: target.y! - 36 / v.scale + (Math.sin(theta) * 16) / v.scale,
          };
          const pos = orbPositions.get(a.id) || { x: 0, y: 0 };
          moveToward(pos, dest, seconds, v.scale);
          orbPositions.set(a.id, pos);
          const color = a.parentId ? "#c4acff" : "#b3ffe1";
          const radius = a.parentId ? 5 : 7;
          if (!browser) {
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
          }
          ctx.shadowColor = color;
          ctx.shadowBlur = browser ? 0 : 16;
          ctx.fillStyle = browser ? color : "#f3fff9";
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          if (a.active) {
            const targetId = a.target || stationFor(a).id;
            let connection = connections.get(a.id);
            if (!connection || connection.target !== targetId) {
              connection = { target: targetId, progress: 0 };
              connections.set(a.id, connection);
            }
            connection.progress = Math.min(
              1,
              connection.progress + seconds / 0.45,
            );
            const reach = p.motion ? 1 - (1 - connection.progress) ** 3 : 1;
            const end = {
              x: pos.x + (target.x! - pos.x) * reach,
              y: pos.y + (target.y! - pos.y) * reach,
            };
            if (!browser) {
              ctx.strokeStyle = color + "60";
              ctx.lineWidth = 4 / v.scale;
              ctx.shadowColor = color;
              ctx.shadowBlur = 12;
              ctx.beginPath();
              ctx.moveTo(pos.x, pos.y);
              ctx.lineTo(end.x, end.y);
              ctx.stroke();
            }
            ctx.shadowBlur = 0;
            ctx.strokeStyle = color + "e0";
            ctx.lineWidth = 1.5 / v.scale;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(end.x, end.y);
            ctx.setLineDash([7 / v.scale, 9 / v.scale]);
            ctx.lineDashOffset = (-t * 24) / v.scale;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineDashOffset = 0;
            for (let packet = 0; packet < 3; packet++) {
              const progress = (t * 0.45 + packet / 3) % 1;
              ctx.fillStyle = "#eafff5";
              ctx.beginPath();
              ctx.arc(
                pos.x + (end.x - pos.x) * progress,
                pos.y + (end.y - pos.y) * progress,
                2 / v.scale,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            }
          }
          ctx.font = '500 10px "DM Sans", "Segoe UI", sans-serif';
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.fillText(`${a.name} · ${a.action}`, pos.x, pos.y + 20);
          orbHits.push({
            id: a.threadId,
            x: pos.x * v.scale + v.width / 2 + v.x,
            y: pos.y * v.scale + v.height / 2 + v.y,
          });
        });
        for (const id of orbPositions.keys())
          if (!agents.some((a) => a.id === id)) {
            orbPositions.delete(id);
            connections.delete(id);
          }
        ctx.restore();
        if (
          !browser ||
          changing ||
          agents.length ||
          v.scale !== v.targetScale ||
          (sim.current && sim.current.alpha() >= sim.current.alphaMin())
        )
          requestDraw(false);
      };
      const fontsChanged = () => {
        textWidths.clear();
        requestDraw();
      };
      // ResizeObserver handles display:none and rotation. Visibility handles app
      // switching; density changes and loaded fonts also invalidate an idle canvas.
      let density = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const densityChanged = () => {
        density.removeEventListener("change", densityChanged);
        density = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        density.addEventListener("change", densityChanged);
        requestDraw();
      };
      density.addEventListener("change", densityChanged);
      document.fonts.addEventListener("loadingdone", fontsChanged);
      document.addEventListener("visibilitychange", updateVisibility);
      updateVisibility();
      requestDraw();
      return () => {
        invalidate.current = () => {};
        cancelAnimationFrame(frame);
        density.removeEventListener("change", densityChanged);
        document.fonts.removeEventListener("loadingdone", fontsChanged);
        document.removeEventListener("visibilitychange", updateVisibility);
        resize.disconnect();
        c.removeEventListener("pointerdown", pointerdown);
        c.removeEventListener("pointermove", pointermove);
        c.removeEventListener("pointerup", pointerup);
        c.removeEventListener("pointercancel", pointerup);
        c.removeEventListener("pointerleave", pointerleave);
        c.removeEventListener("wheel", wheel);
        c.removeEventListener("dblclick", dblclick);
        sim.current?.stop();
      };
    }, []);
    return (
      <div className="graph-surface">
        <canvas
          ref={canvas}
          aria-label="Interactive knowledge graph. Drag notes or activity stations to move them, scroll to zoom, double-click to fit."
        />
        {browser && (
          <canvas
            className="graph-scene"
            ref={sceneCanvas}
            aria-hidden="true"
          />
        )}
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
