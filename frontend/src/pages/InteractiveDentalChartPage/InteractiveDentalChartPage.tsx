import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import dentalChartSvg from '../../assets/dental-chart-interactive.svg?raw';
import './InteractiveDentalChartPage.scss';

type CanalStatus = 'open' | 'filled' | 'partial';
type PeriodontitisSize = 'none' | '3mm' | '3-5mm' | '5mm';
type PeriodontalLevel = 'p0' | 'p1' | 'p2';
type GumInflammation = 'none' | 'mild' | 'medium' | 'severe';
type Quality = 'good' | 'medium' | 'bad';
type SurfaceKind = 'none' | 'caries' | 'fissure' | 'filling' | 'cervical-caries' | 'cervical-filling';
export type SurfaceZone = 'left' | 'right' | 'top' | 'bottom' | 'center' | 'front' | 'back' | 'cervical';
type ToolGroup = 'tooth' | 'lesions' | 'perio' | 'endo' | 'restoration' | 'summary';

export type SurfacePaint = {
    kind: SurfaceKind;
    quality?: Quality;
    order?: number;
};

type ToolAction =
    | { type: 'intact-one' }
    | { type: 'absent' }
    | { type: 'hide-tooth' }
    | { type: 'root'; changed: boolean }
    | { type: 'bolt' }
    | { type: 'canal'; status: CanalStatus }
    | { type: 'periodontitis'; size: PeriodontitisSize }
    | { type: 'gum'; inflammation: GumInflammation; label: string }
    | { type: 'surface'; paint: SurfacePaint; label: string }
    | { type: 'cervical'; paint: SurfacePaint; label: string }
    | { type: 'crown'; quality: Quality };

export type ToothState = {
    visible: boolean;
    absent: boolean;
    rootChanged: boolean;
    canalStatus: CanalStatus;
    bolt: boolean;
    periodontitis: PeriodontitisSize;
    periodontalLevel: PeriodontalLevel;
    gumInflammation: GumInflammation;
    tartar: boolean;
    crown: Quality | null;
    cervical: SurfacePaint;
    surfaces: Record<SurfaceZone, SurfacePaint>;
};
export type DentalFormulaState = Record<number, ToothState>;

export type DentalFormulaEditorProps = {
    value?: DentalFormulaState | null;
    initialValue?: DentalFormulaState | null;
    onChange?: (state: DentalFormulaState) => void;
    readOnly?: boolean;
    embedded?: boolean;
    className?: string;
    changedTeeth?: number[];
    onToothSelect?: (toothNumber: number) => void;
};

type PaintOptions = {
    fill?: string;
    stroke?: string | null;
    strokeWidth?: string | null;
    fillOpacity?: string | null;
    visible?: boolean;
};

type ConfirmState = {
    title: string;
    description: string;
    confirmLabel?: string;
    onConfirm: () => void;
} | null;

const TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] as const;
const UPPER_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28] as const;
const LOWER_TEETH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] as const;
const TOOTH_SET = new Set<number>(TEETH as readonly number[]);

const COLORS = {
    tooth: '#ffffff',
    outline: '#5f5f5f',
    root: '#FFD754',
    rootChanged: '#906B25',
    canalOpen: '#ffffff',
    canalFilled: '#050505',
    canalPartialBottom: '#FFB8AC',
    caries: '#050505',
    fissure: '#80878c',
    fillingGood: '#BDF8FA',
    fillingMedium: '#FFF48D',
    fillingBad: '#FFD6D6',
    gumInflamed: '#bf1d1d',
    periodontal: '#f3d9b3',
    periodontitis: '#b71c1c',
};

const GUM_STROKE: Record<Exclude<GumInflammation, 'none'>, string> = {
    mild: '21',
    medium: '28',
    severe: '36',
};

const PERIODONTITIS_SCALE: Record<Exclude<PeriodontitisSize, 'none'>, number> = {
    '3mm': 1.8,
    '3-5mm': 2.8,
    '5mm': 4,
};

const DEFAULT_SURFACES: Record<SurfaceZone, SurfacePaint> = {
    left: { kind: 'none' },
    right: { kind: 'none' },
    top: { kind: 'none' },
    bottom: { kind: 'none' },
    center: { kind: 'none' },
    front: { kind: 'none' },
    back: { kind: 'none' },
    cervical: { kind: 'none' },
};

const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
    tooth: 'Тип зуба',
    lesions: 'Ураження',
    perio: 'Пародонт',
    endo: 'Endo',
    restoration: 'Конструкції',
    summary: 'Стани',
};

function clonePaint(paint: SurfacePaint): SurfacePaint {
    return { kind: paint.kind, quality: paint.quality, order: paint.order };
}

function cloneSurfaces(surfaces: Record<SurfaceZone, SurfacePaint>) {
    return Object.fromEntries(Object.entries(surfaces).map(([key, value]) => [key, clonePaint(value)])) as Record<SurfaceZone, SurfacePaint>;
}

function createDefaultToothState(visible = false): ToothState {
    return {
        visible,
        absent: false,
        rootChanged: false,
        canalStatus: 'open',
        bolt: false,
        periodontitis: 'none',
        periodontalLevel: 'p0',
        gumInflammation: 'none',
        tartar: false,
        crown: null,
        cervical: { kind: 'none' },
        surfaces: cloneSurfaces(DEFAULT_SURFACES),
    };
}

export function createInitialStates(visible = false): DentalFormulaState {
    return Object.fromEntries(TEETH.map((tooth) => [tooth, createDefaultToothState(visible)]));
}

function cloneToothState(state: ToothState): ToothState {
    return {
        ...state,
        cervical: clonePaint(state.cervical),
        surfaces: cloneSurfaces(state.surfaces),
    };
}
function normalizeDentalFormulaState(value?: DentalFormulaState | null): DentalFormulaState {
    const base = createInitialStates(false);

    if (!value || typeof value !== 'object') {
        return base;
    }

    TEETH.forEach((tooth) => {
        const incoming = value[tooth];

        if (!incoming || typeof incoming !== 'object') {
            return;
        }

        base[tooth] = {
            ...createDefaultToothState(false),
            ...incoming,
            cervical: incoming.cervical ? clonePaint(incoming.cervical) : { kind: 'none' },
            surfaces: {
                ...cloneSurfaces(DEFAULT_SURFACES),
                ...(incoming.surfaces || {}),
            },
        };
    });

    return base;
}

function qualityColor(quality: Quality) {
    if (quality === 'good') return COLORS.fillingGood;
    if (quality === 'medium') return COLORS.fillingMedium;
    return COLORS.fillingBad;
}

function fillForSurface(paint: SurfacePaint) {
    if (paint.kind === 'caries' || paint.kind === 'cervical-caries') return COLORS.caries;
    if (paint.kind === 'fissure') return COLORS.fissure;
    if (paint.kind === 'filling' || paint.kind === 'cervical-filling') return qualityColor(paint.quality || 'good');
    return COLORS.tooth;
}

function actionLabel(action: ToolAction | null) {
    if (!action) return 'Оберіть інструмент';
    if (action.type === 'intact-one') return 'Один інтактний';
    if (action.type === 'absent') return 'Відсутній зуб';
    if (action.type === 'hide-tooth') return 'Прибрати зуб';
    if (action.type === 'root') return action.changed ? 'Змінений корінь' : 'Корінь зуба';
    if (action.type === 'bolt') return 'Штифт';
    if (action.type === 'canal') return 'Канал';
    if (action.type === 'periodontitis') return action.size === 'none' ? 'Без періодонтиту' : `Періодонтит ${action.size}`;
    if (action.type === 'gum') return action.label;
    if (action.type === 'surface') return action.label;
    if (action.type === 'cervical') return action.label;
    if (action.type === 'crown') return `Коронка ${action.quality}`;
    return 'Оберіть інструмент';
}

function actionKey(action: ToolAction | null) {
    if (!action) return 'none';

    switch (action.type) {
        case 'intact-one':
        case 'absent':
        case 'hide-tooth':
        case 'bolt':
            return action.type;
        case 'root':
            return `${action.type}:${action.changed ? 'changed' : 'default'}`;
        case 'canal':
            return `${action.type}:${action.status}`;
        case 'periodontitis':
            return `${action.type}:${action.size}`;
        case 'gum':
            return `${action.type}:${action.inflammation}`;
        case 'surface':
        case 'cervical':
            return `${action.type}:${action.paint.kind}:${action.paint.quality || 'default'}`;
        case 'crown':
            return `${action.type}:${action.quality}`;
        default:
            return 'none';
    }
}

function isActionSelected(current: ToolAction | null, candidate: ToolAction) {
    return actionKey(current) === actionKey(candidate);
}

function getToothFromId(id: string): number | null {
    if (/^\d+$/.test(id)) {
        const n = Number(id);
        return TOOTH_SET.has(n) ? n : null;
    }

    const patterns = [
        /^hit_(\d{2})$/,
        /^(?:root|canal_top|canal_bottom|bolt|pulpit|tartar|decoration|hole)_(\d{2})(?:_|$)/,
        /^gum_(\d{2})_p[0-2]$/,
        /^(\d{2})_p[0-2]$/,
        /^head_(?:left|right|top|bottom|center)_(\d{2})$/,
        /^topview_(?:left|right|front|back)_(\d{2})$/,
        /^topview_center_(\d{2})(?:_|$)/,
        /^[^_]*ervical_(\d{2})(?:_|$)/,
    ];

    for (const pattern of patterns) {
        const match = id.match(pattern);
        if (!match) continue;
        const n = Number(match[1]);
        if (TOOTH_SET.has(n)) return n;
    }

    return null;
}

function getSurfaceFromId(id: string): { tooth: number; zone: SurfaceZone } | null {
    let match = id.match(/^head_(left|right|top|bottom|center)_(\d{2})$/);
    if (match) {
        const tooth = Number(match[2]);
        if (!TOOTH_SET.has(tooth)) return null;
        return { tooth, zone: match[1] as SurfaceZone };
    }

    match = id.match(/^topview_(left|right|front|back)_(\d{2})$/);
    if (match) {
        const tooth = Number(match[2]);
        if (!TOOTH_SET.has(tooth)) return null;
        return { tooth, zone: match[1] as SurfaceZone };
    }

    match = id.match(/^topview_center_(\d{2})(?:_|$)/);
    if (match) {
        const tooth = Number(match[1]);
        if (!TOOTH_SET.has(tooth)) return null;
        return { tooth, zone: 'top' };
    }

    match = id.match(/^[^_]*ervical_(\d{2})(?:_|$)/);
    if (match) {
        const tooth = Number(match[1]);
        if (!TOOTH_SET.has(tooth)) return null;
        return { tooth, zone: 'cervical' };
    }

    return null;
}

function isSurfacePreciseAction(action: ToolAction | null) {
    return Boolean(action && (action.type === 'surface' || action.type === 'cervical'));
}

function uniqueElementsById(elements: SVGElement[]) {
    const seen = new Set<string>();
    return elements.filter((element) => {
        const key = element.id || element.tagName;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getStackedSvgTargets(event: MouseEvent<HTMLDivElement>) {
    const stack = document.elementsFromPoint(event.clientX, event.clientY)
        .filter((node): node is SVGElement => node instanceof SVGElement)
        .map((node) => node.closest<SVGElement>('[id]') || node)
        .filter((node): node is SVGElement => Boolean(node?.id))
        .filter((node) => !/^\d{1,2}$/.test(sourceIdFromElement(node)))
        .filter((node) => !/^hit_\d{2}$/.test(sourceIdFromElement(node)));

    return uniqueElementsById(stack);
}

function getSvgPointFromEvent(event: MouseEvent<HTMLDivElement>) {
    const svg = (event.currentTarget.querySelector('svg') || null) as SVGSVGElement | null;
    if (!svg) return null;

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;

    const matrix = svg.getScreenCTM();
    if (!matrix) return null;

    return point.matrixTransform(matrix.inverse());
}

function getBBoxSafe(element: SVGElement) {
    try {
        return (element as unknown as SVGGraphicsElement).getBBox();
    } catch {
        return null;
    }
}

function unionBoxes(boxes: DOMRect[]) {
    if (!boxes.length) return null;

    const minX = Math.min(...boxes.map((box) => box.x));
    const minY = Math.min(...boxes.map((box) => box.y));
    const maxX = Math.max(...boxes.map((box) => box.x + box.width));
    const maxY = Math.max(...boxes.map((box) => box.y + box.height));

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        centerX: minX + (maxX - minX) / 2,
        centerY: minY + (maxY - minY) / 2,
    };
}

function getTopviewUnionBox(svg: SVGSVGElement, tooth: number) {
    const boxes = elementsByRegex(svg, new RegExp(`^topview_(?:front|back|left|right|center)_${tooth}(?:_|$)`))
        .map(getBBoxSafe)
        .filter((box): box is DOMRect => Boolean(box && box.width > 0 && box.height > 0));

    return unionBoxes(boxes);
}

function getFallbackTopviewSurface(event: MouseEvent<HTMLDivElement>, action: ToolAction) {
    if (action.type === 'cervical') return null;

    const svg = (event.currentTarget.querySelector('svg') || null) as SVGSVGElement | null;
    const point = getSvgPointFromEvent(event);
    if (!svg || !point) return null;

    const padding = 18;

    for (const tooth of TEETH) {
        const box = getTopviewUnionBox(svg, tooth);
        if (!box) continue;

        const inside = point.x >= box.x - padding
            && point.x <= box.x + box.width + padding
            && point.y >= box.y - padding
            && point.y <= box.y + box.height + padding;

        if (!inside) continue;

        const relativeX = (point.x - box.x) / box.width;
        const relativeY = (point.y - box.y) / box.height;

        if (relativeX <= 0.24) return { tooth, zone: 'left' as SurfaceZone };
        if (relativeX >= 0.76) return { tooth, zone: 'right' as SurfaceZone };

        if (!isAnteriorTooth(tooth) && relativeX > 0.34 && relativeX < 0.66 && relativeY > 0.34 && relativeY < 0.66) {
            return { tooth, zone: 'top' as SurfaceZone };
        }

        return {
            tooth,
            zone: (relativeY >= 0.5 ? 'front' : 'back') as SurfaceZone,
        };
    }

    return null;
}

function getToothUnionBox(svg: SVGSVGElement, tooth: number) {
    const boxes = elementsByRegex(
        svg,
        new RegExp(`^(?:root|canal_top|canal_bottom|bolt|pulpit|tartar|decoration|hole)_${tooth}(?:_|$)|^gum_${tooth}_p[0-2]$|^${tooth}_p[0-2]$|^head_(?:left|right|top|bottom|center)_${tooth}$|^topview_(?:front|back|left|right|center)_${tooth}(?:_|$)|^[^_]*ervical_${tooth}(?:_|$)`),
    )
        .map(getBBoxSafe)
        .filter((box): box is DOMRect => Boolean(box && box.width > 0 && box.height > 0));

    return unionBoxes(boxes);
}

function getFallbackTooth(event: MouseEvent<HTMLDivElement>) {
    const svg = (event.currentTarget.querySelector('svg') || null) as SVGSVGElement | null;
    const point = getSvgPointFromEvent(event);
    if (!svg || !point) return null;

    const padding = 20;

    for (const tooth of TEETH) {
        const box = getToothUnionBox(svg, tooth);
        if (!box) continue;

        const inside = point.x >= box.x - padding
            && point.x <= box.x + box.width + padding
            && point.y >= box.y - padding
            && point.y <= box.y + box.height + padding;

        if (inside) return tooth;
    }

    return null;
}

function resolveActionTarget(event: MouseEvent<HTMLDivElement>, action: ToolAction) {
    const stack = getStackedSvgTargets(event);

    if (action.type === 'cervical') {
        const exactCervical = stack
            .map((element) => ({ element, surface: getSurfaceFromElement(element) }))
            .find(({ surface }) => surface?.zone === 'cervical');

        if (exactCervical?.surface) {
            return { tooth: exactCervical.surface.tooth, zone: 'cervical' as SurfaceZone };
        }

        const toothFromStack = stack
            .map((element) => getToothFromId(sourceIdFromElement(element)))
            .find((value): value is number => value !== null);

        if (typeof toothFromStack === 'number') {
            return { tooth: toothFromStack, zone: 'cervical' as SurfaceZone };
        }

        const toothFromGeometry = getFallbackTooth(event);
        if (typeof toothFromGeometry === 'number') {
            return { tooth: toothFromGeometry, zone: 'cervical' as SurfaceZone };
        }

        return null;
    }

    if (isSurfacePreciseAction(action)) {
        const candidates = stack
            .map((element) => ({ element, surface: getSurfaceFromElement(element) }))
            .filter((item): item is { element: SVGElement; surface: { tooth: number; zone: SurfaceZone } } => Boolean(item.surface))
            .filter(({ surface }) => surface.zone !== 'cervical')
            .sort((a, b) => {
                const aProxy = a.element.id.startsWith('surfacehit_') ? 1 : 0;
                const bProxy = b.element.id.startsWith('surfacehit_') ? 1 : 0;
                return aProxy - bProxy;
            });

        const preferredSurface = candidates[0];
        if (preferredSurface?.surface) {
            return { tooth: preferredSurface.surface.tooth, zone: preferredSurface.surface.zone };
        }

        return getFallbackTopviewSurface(event, action);
    }

    const toothFromStack = stack
        .map((element) => getToothFromId(sourceIdFromElement(element)))
        .find((value): value is number => value !== null);

    if (typeof toothFromStack === 'number') {
        return { tooth: toothFromStack };
    }

    const target = event.target as Element | null;
    const fallback = target?.closest<SVGElement>('[id]') || null;
    const fallbackTooth = fallback ? getToothFromId(sourceIdFromElement(fallback)) : null;
    if (fallbackTooth) return { tooth: fallbackTooth };

    return null;
}

function isAnteriorTooth(tooth: number) {
    const unit = tooth % 10;
    return unit >= 1 && unit <= 3;
}


function cervicalRegex(tooth: number) {
    return new RegExp(`^[^_]*ervical_${tooth}(?:_|$)`);
}

function raiseRegex(svg: SVGSVGElement, regex: RegExp) {
    elementsByRegex(svg, regex).forEach((element) => {
        element.parentElement?.appendChild(element);
    });
}

function applyScaleAroundCenter(element: SVGElement, scale: number) {
    const graphicsElement = element as unknown as SVGGraphicsElement;
    if (!element.dataset.originalTransformApplied) {
        element.dataset.originalTransform = element.getAttribute('transform') || '';
        element.dataset.originalTransformApplied = '1';
    }

    const original = element.dataset.originalTransform || '';
    const box = graphicsElement.getBBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const scaleTransform = `translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`;
    element.setAttribute('transform', original ? `${original} ${scaleTransform}` : scaleTransform);
}

function captureOriginalOrder(svg: SVGSVGElement) {
    Array.from(svg.querySelectorAll<SVGElement>('*')).forEach((element, index) => {
        if (!element.dataset.originalOrder) {
            element.dataset.originalOrder = String(index);
        }
    });
}

function restoreOriginalOrder(svg: SVGSVGElement) {
    Array.from(svg.querySelectorAll<SVGElement>('g, svg')).forEach((parent) => {
        const children = Array.from(parent.children) as SVGElement[];
        children
            .sort((a, b) => Number(a.dataset.originalOrder || '999999') - Number(b.dataset.originalOrder || '999999'))
            .forEach((child) => parent.appendChild(child));
    });
}

function setDisplay(element: SVGElement | null, visible: boolean) {
    if (!element) return;
    element.style.display = visible ? '' : 'none';
    if (visible) {
        element.querySelectorAll<SVGElement>('*').forEach((child) => {
            child.style.display = '';
        });
    }
}

function setPaint(element: SVGElement | null, options: PaintOptions) {
    if (!element) return;
    if (typeof options.visible === 'boolean') setDisplay(element, options.visible);

    const targets = [element, ...Array.from(element.querySelectorAll<SVGElement>('*'))];
    targets.forEach((target) => {
        if (typeof options.fill === 'string') {
            target.setAttribute('fill', options.fill);
            target.style.fill = options.fill;
        }

        if (options.stroke === null) {
            target.removeAttribute('stroke');
            target.style.stroke = 'none';
        } else if (typeof options.stroke === 'string') {
            target.setAttribute('stroke', options.stroke);
            target.style.stroke = options.stroke;
        }

        if (options.strokeWidth === null) {
            target.removeAttribute('stroke-width');
            target.style.strokeWidth = '';
        } else if (typeof options.strokeWidth === 'string') {
            target.setAttribute('stroke-width', options.strokeWidth);
            target.style.strokeWidth = options.strokeWidth;
        }

        if (options.fillOpacity === null) {
            target.removeAttribute('fill-opacity');
            target.style.fillOpacity = '';
        } else if (typeof options.fillOpacity === 'string') {
            target.setAttribute('fill-opacity', options.fillOpacity);
            target.style.fillOpacity = options.fillOpacity;
        }
    });
}

function elementsByRegex(svg: SVGSVGElement, regex: RegExp) {
    return Array.from(svg.querySelectorAll<SVGElement>('[id]')).filter((element) => regex.test(element.id));
}

function paintRegex(svg: SVGSVGElement, regex: RegExp, options: PaintOptions) {
    elementsByRegex(svg, regex).forEach((element) => setPaint(element, options));
}

function forEachIdentifiedElement(svg: SVGSVGElement, callback: (element: SVGElement) => void) {
    svg.querySelectorAll<SVGElement>('[id]').forEach(callback);
}

function isAlwaysVisibleId(id: string) {
    return /^\d{1,2}(?:-\d{1,2})?$/.test(id)
        || id === 'x_line'
        || id === 'y_line'
        || id === 'interactive_dental_hit_layer'
        || id === 'interactive_dental_surface_hit_layer'
        || /^hit_\d{2}$/.test(id)
        || /^surfacehit_/.test(id);
}

function resetSvg(svg: SVGSVGElement) {
    restoreOriginalOrder(svg);

    svg.querySelectorAll<SVGElement>('*').forEach((element) => {
        const tag = element.tagName.toLowerCase();
        const structural = tag === 'defs' || tag === 'lineargradient' || tag === 'clippath' || tag === 'mask' || tag === 'pattern';

        if (structural) {
            element.style.display = '';
            return;
        }

        element.classList.remove('interactive-dental-chart-clickable');
        element.style.transform = '';
        element.style.transformBox = '';
        element.style.transformOrigin = '';
        element.style.fillOpacity = '';

        if (element.dataset.originalTransformApplied) {
            const original = element.dataset.originalTransform || '';
            if (original) {
                element.setAttribute('transform', original);
            } else {
                element.removeAttribute('transform');
            }
        }

        if (element.id && isAlwaysVisibleId(element.id)) {
            element.style.display = '';
            if (/^hit_\d{2}$/.test(element.id)) {
                element.classList.add('interactive-dental-chart-hit-area');
                element.style.pointerEvents = 'all';
                element.style.cursor = 'pointer';
            }
            return;
        }

        if (tag === 'svg' || tag === 'g') {
            element.style.display = '';
        } else {
            element.style.display = 'none';
        }

        element.style.cursor = '';
    });
}

function ensureHitAreas(svg: SVGSVGElement) {
    if (svg.querySelector('#interactive_dental_hit_layer')) return;

    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('id', 'interactive_dental_hit_layer');

    const makeRow = (teeth: readonly number[], isUpper: boolean) => {
        const items = teeth
            .map((tooth) => {
                const label = svg.getElementById(String(tooth)) as SVGGraphicsElement | null;
                if (!label) return null;
                try {
                    const box = label.getBBox();
                    return { tooth, box, centerX: box.x + box.width / 2, centerY: box.y + box.height / 2 };
                } catch {
                    return null;
                }
            })
            .filter((item): item is { tooth: number; box: DOMRect; centerX: number; centerY: number } => Boolean(item))
            .sort((a, b) => a.centerX - b.centerX);

        items.forEach((item, index) => {
            const previous = items[index - 1];
            const next = items[index + 1];
            const left = previous ? (previous.centerX + item.centerX) / 2 : item.centerX - 46;
            const right = next ? (next.centerX + item.centerX) / 2 : item.centerX + 46;
            const top = isUpper ? item.centerY - 260 : item.centerY - 82;
            const bottom = isUpper ? item.centerY + 82 : item.centerY + 270;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('id', `hit_${item.tooth}`);
            rect.setAttribute('x', String(left));
            rect.setAttribute('y', String(top));
            rect.setAttribute('width', String(Math.max(24, right - left)));
            rect.setAttribute('height', String(Math.max(24, bottom - top)));
            rect.setAttribute('fill', 'transparent');
            rect.setAttribute('stroke', 'none');
            rect.setAttribute('pointer-events', 'all');
            rect.classList.add('interactive-dental-chart-hit-area');
            layer.appendChild(rect);
        });
    };

    makeRow(UPPER_TEETH, true);
    makeRow(LOWER_TEETH, false);

    const firstPaintedChild = Array.from(svg.children).find((child) => {
        const tag = child.tagName.toLowerCase();
        return tag !== 'defs' && tag !== 'style' && tag !== 'title' && tag !== 'desc';
    });

    svg.insertBefore(layer, firstPaintedChild || svg.firstChild);
}

function sourceIdFromElement(element: SVGElement) {
    return element.dataset.sourceId || element.id;
}

function getSurfaceFromElement(element: SVGElement) {
    return getSurfaceFromId(sourceIdFromElement(element));
}

function isInteractiveSurfaceElementId(id: string) {
    return /^head_(left|right|top|bottom|center)_\d{2}$/.test(id)
        || /^topview_(left|right|front|back)_\d{2}$/.test(id)
        || /^topview_center_\d{2}(?:_|$)/.test(id)
        || /^[^_]*ervical_\d{2}(?:_|$)/.test(id);
}

function ensureSurfaceHitAreas(svg: SVGSVGElement) {
    if (svg.querySelector('#interactive_dental_surface_hit_layer')) return;

    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    layer.setAttribute('id', 'interactive_dental_surface_hit_layer');
    layer.classList.add('interactive-dental-chart-surface-hit-layer');

    const surfaceElements = Array.from(svg.querySelectorAll<SVGElement>('[id]'))
        .filter((element) => isInteractiveSurfaceElementId(element.id));

    surfaceElements.forEach((element, index) => {
        const graphicsElement = element as unknown as SVGGraphicsElement;

        try {
            const box = graphicsElement.getBBox();
            if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || box.width <= 0 || box.height <= 0) return;

            const padding = element.id.includes('topview_') ? 7 : 3;
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('id', `surfacehit_${index}`);
            rect.dataset.sourceId = element.id;
            rect.setAttribute('x', String(box.x - padding));
            rect.setAttribute('y', String(box.y - padding));
            rect.setAttribute('width', String(box.width + padding * 2));
            rect.setAttribute('height', String(box.height + padding * 2));
            rect.setAttribute('fill', 'transparent');
            rect.setAttribute('stroke', 'none');
            rect.setAttribute('pointer-events', 'none');
            rect.classList.add('interactive-dental-chart-surface-hit');
            layer.appendChild(rect);
        } catch {
            // Some SVG nodes may not expose geometry. They are ignored.
        }
    });

    svg.appendChild(layer);
}

function periodontalFill() {
    return COLORS.periodontal;
}

function showBaseTooth(svg: SVGSVGElement, tooth: number, state: ToothState, opacity = 1) {
    const rootFill = state.rootChanged ? COLORS.rootChanged : COLORS.root;
    const canalTopFill = state.canalStatus === 'open' ? COLORS.canalOpen : COLORS.canalFilled;
    const canalBottomFill = state.canalStatus === 'open'
        ? COLORS.canalOpen
        : state.canalStatus === 'filled'
            ? COLORS.canalFilled
            : COLORS.canalPartialBottom;
    const fillOpacity = opacity < 1 ? String(opacity) : null;

    paintRegex(svg, new RegExp(`^root_${tooth}$`), { fill: rootFill, stroke: '#F2C84B', strokeWidth: '0.8', fillOpacity: fillOpacity || '1', visible: true });
    paintRegex(svg, new RegExp(`^canal_top_${tooth}$`), { fill: canalTopFill, stroke: null, fillOpacity: fillOpacity || '1', visible: true });
    paintRegex(svg, new RegExp(`^canal_bottom_${tooth}$`), { fill: canalBottomFill, stroke: null, fillOpacity: fillOpacity || '1', visible: true });

    if (state.bolt) {
        paintRegex(svg, new RegExp(`^root_${tooth}$`), { visible: false });
        paintRegex(svg, new RegExp(`^canal_top_${tooth}$`), { visible: false });
        paintRegex(svg, new RegExp(`^canal_bottom_${tooth}$`), { visible: false });
        paintRegex(svg, new RegExp(`^bolt_${tooth}$`), { fill: '#050505', stroke: '#050505', fillOpacity: fillOpacity || '1', visible: true });
    }
}

function pickLatestPaint(...candidates: Array<SurfacePaint | undefined>) {
    return candidates
        .filter((paint): paint is SurfacePaint => Boolean(paint && paint.kind !== 'none'))
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .at(-1) || null;
}

function resolveSurfaceTargets(tooth: number, state: ToothState) {
    const surfaces = state.surfaces;
    const anterior = isAnteriorTooth(tooth);

    const logicalFront = anterior
        ? pickLatestPaint(surfaces.front, surfaces.center)
        : pickLatestPaint(surfaces.front);
    const logicalBack = pickLatestPaint(surfaces.back);

    const result = {
        headLeft: pickLatestPaint(surfaces.left),
        headRight: pickLatestPaint(surfaces.right),
        headTop: anterior
            ? null
            : pickLatestPaint(surfaces.top, surfaces.front),
        headBottom: anterior
            ? null
            : pickLatestPaint(surfaces.bottom, surfaces.front),
        headCenter: anterior
            ? pickLatestPaint(surfaces.center, surfaces.front)
            : null,
        topLeft: pickLatestPaint(surfaces.left),
        topRight: pickLatestPaint(surfaces.right),
        topFront: logicalFront,
        topBack: logicalBack,
        topCenter: anterior
            ? null
            : pickLatestPaint(surfaces.top),
    };

    return result;
}

function applyResolvedSurfaces(svg: SVGSVGElement, tooth: number, state: ToothState) {
    const resolved = resolveSurfaceTargets(tooth, state);

    const applyIfPresent = (paint: SurfacePaint | null, regex: RegExp) => {
        if (!paint) return;
        paintRegex(svg, regex, { fill: fillForSurface(paint), visible: true });
    };

    applyIfPresent(resolved.headLeft, new RegExp(`^head_left_${tooth}$`));
    applyIfPresent(resolved.headRight, new RegExp(`^head_right_${tooth}$`));
    applyIfPresent(resolved.headTop, new RegExp(`^head_top_${tooth}$`));
    applyIfPresent(resolved.headBottom, new RegExp(`^head_bottom_${tooth}$`));
    applyIfPresent(resolved.headCenter, new RegExp(`^head_center_${tooth}$`));
    applyIfPresent(resolved.topLeft, new RegExp(`^topview_left_${tooth}$`));
    applyIfPresent(resolved.topRight, new RegExp(`^topview_right_${tooth}$`));
    applyIfPresent(resolved.topFront, new RegExp(`^topview_front_${tooth}$`));
    applyIfPresent(resolved.topBack, new RegExp(`^topview_back_${tooth}$`));
    applyIfPresent(resolved.topCenter, new RegExp(`^topview_center_${tooth}(?:_|$)`));

    if (state.cervical.kind !== 'none') {
        paintRegex(svg, cervicalRegex(tooth), {
            fill: fillForSurface(state.cervical),
            stroke: COLORS.outline,
            strokeWidth: '1',
            fillOpacity: '1',
            visible: true,
        });
        raiseRegex(svg, cervicalRegex(tooth));
    }
}

function showPreviewTooth(svg: SVGSVGElement, tooth: number) {
    const previewState = createDefaultToothState(true);
    const opacity = 0.16;

    showBaseTooth(svg, tooth, previewState, opacity);
    paintRegex(svg, new RegExp(`^head_(left|right|top|bottom|center)_${tooth}$`), {
        fill: COLORS.tooth,
        stroke: COLORS.outline,
        strokeWidth: '1.05',
        fillOpacity: String(opacity),
        visible: true,
    });
    paintRegex(svg, new RegExp(`^topview_(left|right|front|back|center)_${tooth}(?:_|$)`), {
        fill: COLORS.tooth,
        stroke: COLORS.outline,
        strokeWidth: '1.05',
        fillOpacity: String(opacity),
        visible: true,
    });
    paintRegex(svg, new RegExp(`^decoration_${tooth}(?:_|$)`), {
        fill: COLORS.tooth,
        stroke: COLORS.outline,
        strokeWidth: '1.05',
        fillOpacity: String(opacity),
        visible: true,
    });
    paintRegex(svg, new RegExp(`^${tooth}_p0$`), {
        fill: periodontalFill(),
        stroke: null,
        fillOpacity: '0.34',
        visible: true,
    });
}

function applySvgState(
    svg: SVGSVGElement,
    states: DentalFormulaState,
    previewTooth: number | null = null,
    changedTeeth: number[] = [],
) {
    resetSvg(svg);

    forEachIdentifiedElement(svg, (element) => {
        const isNumberLabel = /^\d{1,2}$/.test(element.id);
        const isSyntheticHit = /^hit_\d{2}$/.test(element.id) || /^surfacehit_/.test(element.id);

        if (!isNumberLabel && !isSyntheticHit && (getToothFromId(element.id) || getSurfaceFromId(element.id))) {
            element.classList.add('interactive-dental-chart-clickable');
        }
    });

    TEETH.forEach((tooth) => {
        const state = states[tooth];
        if (!state.visible) {
            if (previewTooth === tooth) {
                showPreviewTooth(svg, tooth);
            }
            return;
        }

        showBaseTooth(svg, tooth, state);

        if (state.absent) {
            paintRegex(svg, new RegExp(`^head_(left|right|top|bottom|center)_${tooth}(?:_|$)`), { visible: false });
            paintRegex(svg, new RegExp(`^topview_(left|right|front|back|center)_${tooth}(?:_|$)`), {
                fill: state.rootChanged ? COLORS.rootChanged : COLORS.root,
                stroke: null,
                fillOpacity: '1',
                visible: true,
            });
            paintRegex(svg, new RegExp(`^decoration_${tooth}(?:_|$)`), {
                fill: state.rootChanged ? COLORS.rootChanged : COLORS.root,
                stroke: null,
                fillOpacity: '1',
                visible: true,
            });
            paintRegex(svg, new RegExp(`^hole_${tooth}(?:_\\d+)?$`), {
                fill: state.canalStatus === 'open'
                    ? COLORS.canalOpen
                    : state.canalStatus === 'filled'
                        ? COLORS.canalFilled
                        : COLORS.canalPartialBottom,
                stroke: null,
                fillOpacity: '1',
                visible: true,
            });
            raiseRegex(svg, new RegExp(`^hole_${tooth}(?:_\\d+)?$`));
        } else {
            paintRegex(svg, new RegExp(`^head_(left|right|top|bottom|center)_${tooth}$`), {
                fill: COLORS.tooth,
                stroke: COLORS.outline,
                strokeWidth: '1.15',
                fillOpacity: '1',
                visible: true,
            });
            paintRegex(svg, new RegExp(`^topview_(left|right|front|back|center)_${tooth}(?:_|$)`), {
                fill: COLORS.tooth,
                stroke: COLORS.outline,
                strokeWidth: '1.15',
                fillOpacity: '1',
                visible: true,
            });
            paintRegex(svg, new RegExp(`^decoration_${tooth}(?:_|$)`), {
                fill: COLORS.tooth,
                stroke: COLORS.outline,
                strokeWidth: '1.15',
                fillOpacity: '1',
                visible: true,
            });

            raiseRegex(svg, new RegExp(`^head_(left|right|top|bottom|center)_${tooth}$`));
            raiseRegex(svg, new RegExp(`^topview_(left|right|front|back|center)_${tooth}(?:_|$)`));
            raiseRegex(svg, new RegExp(`^decoration_${tooth}(?:_|$)`));

            if (state.crown) {
                const fill = qualityColor(state.crown);
                paintRegex(svg, new RegExp(`^head_(left|right|top|bottom|center)_${tooth}$`), { fill, visible: true });
                paintRegex(svg, new RegExp(`^topview_(left|right|front|back|center)_${tooth}(?:_|$)`), { fill, visible: true });
            } else {
                applyResolvedSurfaces(svg, tooth, state);
            }

            if (state.periodontitis !== 'none') {
                const scale = PERIODONTITIS_SCALE[state.periodontitis];
                elementsByRegex(svg, new RegExp(`^pulpit_${tooth}(?:_|$)`)).forEach((element) => {
                    setPaint(element, {
                        fill: COLORS.periodontitis,
                        stroke: COLORS.periodontitis,
                        strokeWidth: '0.45',
                        visible: true,
                    });
                    applyScaleAroundCenter(element, scale);
                    element.parentElement?.appendChild(element);
                });
            }

            if (state.tartar) {
                elementsByRegex(svg, new RegExp(`^tartar_${tooth}(?:_\\d+)?$`)).forEach((element) => {
                    setDisplay(element, true);
                });
                raiseRegex(svg, new RegExp(`^tartar_${tooth}(?:_\\d+)?$`));
            }
        }

        paintRegex(svg, new RegExp(`^${tooth}_${state.periodontalLevel}$`), {
            fill: periodontalFill(),
            stroke: null,
            fillOpacity: '0.78',
            visible: true,
        });

        if (state.gumInflammation !== 'none') {
            paintRegex(svg, new RegExp(`^gum_${tooth}_${state.periodontalLevel}$`), {
                fill: 'none',
                stroke: COLORS.gumInflamed,
                strokeWidth: GUM_STROKE[state.gumInflammation],
                visible: true,
            });
        }
        if (changedTeeth.includes(tooth) && !state.absent) {
            paintRegex(svg, new RegExp(`^head_(left|right|top|bottom|center)_${tooth}$`), {
                stroke: '#24324a',
                strokeWidth: '1.2',
                visible: true,
            });

            paintRegex(svg, new RegExp(`^topview_(left|right|front|back|center)_${tooth}(?:_|$)`), {
                stroke: '#24324a',
                strokeWidth: '1.2',
                visible: true,
            });
        }
    });
}

function readableQuality(quality: Quality) {
    if (quality === 'good') return 'добра';
    if (quality === 'medium') return 'середня';
    return 'погана';
}

function buildSummary(states: Record<number, ToothState>) {
    const rows: Array<{ label: string; teeth: number[] }> = [];
    const push = (label: string, predicate: (state: ToothState) => boolean) => {
        const teeth = TEETH.filter((tooth) => predicate(states[tooth]));
        if (teeth.length) rows.push({ label, teeth });
    };

    push('Видимі зуби', (state) => state.visible);
    push('Відсутні зуби', (state) => state.visible && state.absent);
    push('Змінений корінь', (state) => state.visible && state.rootChanged);
    push('Штифт', (state) => state.visible && !state.absent && state.bolt);
    push('Періодонтит', (state) => state.visible && !state.absent && state.periodontitis !== 'none');
    push('Пародонт 1 ст', (state) => state.visible && state.periodontalLevel === 'p1');
    push('Пародонт 2 ст', (state) => state.visible && state.periodontalLevel === 'p2');
    push('Запалення ясен', (state) => state.visible && !state.absent && state.gumInflammation !== 'none');
    push('Зубний камінь', (state) => state.visible && !state.absent && state.tartar);
    push('Коронка', (state) => state.visible && !state.absent && Boolean(state.crown));

    return rows;
}

function visibleTeeth(states: Record<number, ToothState>) {
    return TEETH.filter((tooth) => states[tooth].visible);
}

export function DentalFormulaEditor({
                                        value,
                                        initialValue,
                                        onChange,
                                        readOnly = false,
                                        embedded = false,
                                        className = '',
                                        changedTeeth = [],
                                        onToothSelect,
                                    }: DentalFormulaEditorProps) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const paintOrderRef = useRef(1);
    const isControlled = typeof value !== 'undefined';

    const [internalStates, setInternalStates] = useState<DentalFormulaState>(() =>
        normalizeDentalFormulaState(value || initialValue || null),
    );

    const controlledStates = useMemo(
        () => normalizeDentalFormulaState(value || null),
        [value],
    );

    const states = isControlled ? controlledStates : internalStates;
    const [activeGroup, setActiveGroup] = useState<ToolGroup>('tooth');
    const [pendingAction, setPendingAction] = useState<ToolAction | null>(null);
    const [message, setMessage] = useState('Оберіть інструмент і клікніть по зубу або конкретній поверхні. Інструмент скидається після застосування.');
    const [hoverTooth, setHoverTooth] = useState<number | null>(null);
    const [confirmState, setConfirmState] = useState<ConfirmState>(null);

    const summary = useMemo(() => buildSummary(states), [states]);
    const visibleCount = useMemo(() => visibleTeeth(states).length, [states]);

    useEffect(() => {
        if (!isControlled && initialValue) {
            setInternalStates(normalizeDentalFormulaState(initialValue));
        }
    }, [initialValue, isControlled]);

    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) return;

        let svg = host.querySelector<SVGSVGElement>('svg');
        if (!svg) {
            host.innerHTML = dentalChartSvg;
            svg = host.querySelector<SVGSVGElement>('svg');
        }

        if (!svg) return;
        ensureHitAreas(svg);
        ensureSurfaceHitAreas(svg);
        captureOriginalOrder(svg);
        applySvgState(svg, states, pendingAction?.type === 'intact-one' ? hoverTooth : null, changedTeeth);
    }, [states, activeGroup, pendingAction, hoverTooth, changedTeeth]);

    function nextPaintOrder() {
        const current = paintOrderRef.current;
        paintOrderRef.current += 1;
        return current;
    }

    function requestConfirmation(title: string, description: string, onConfirm: () => void, confirmLabel = 'Підтвердити') {
        setConfirmState({title, description, onConfirm, confirmLabel});
    }

    function commitStates(nextOrUpdater: DentalFormulaState | ((prev: DentalFormulaState) => DentalFormulaState)) {
        if (readOnly) return;

        if (isControlled) {
            const next = typeof nextOrUpdater === 'function'
                ? nextOrUpdater(states)
                : nextOrUpdater;

            onChange?.(normalizeDentalFormulaState(next));
            return;
        }

        setInternalStates((prev) => {
            const next = typeof nextOrUpdater === 'function'
                ? nextOrUpdater(prev)
                : nextOrUpdater;

            return normalizeDentalFormulaState(next);
        });
    }

    function updateTeeth(teeth: readonly number[], patcher: (state: ToothState) => ToothState, nextMessage?: string) {
        commitStates((prev) => {
            const next = {...prev};
            teeth.forEach((tooth) => {
                next[tooth] = patcher(cloneToothState(prev[tooth]));
            });
            return next;
        });

        if (nextMessage) setMessage(nextMessage);
    }

    function setAction(action: ToolAction) {
        if (readOnly) return;
        setPendingAction(action);
        setMessage(`Активний інструмент: ${actionLabel(action)}. Клікайте по зубах або поверхнях — інструмент залишиться активним, поки ви його не скинете.`);
    }

    function clearAction() {
        setPendingAction(null);
        setHoverTooth(null);
        setMessage('Інструмент скинуто. Оберіть новий інструмент.');
    }

    function toolButtonClass(action: ToolAction, extraClass = '') {
        return `${isActionSelected(pendingAction, action) ? 'is-selected' : ''} ${extraClass}`.trim();
    }

    function applyAllIntact() {
        if (readOnly) return;
        const hidden = TEETH.filter((tooth) => !states[tooth].visible);
        if (!hidden.length) {
            setMessage('Усі зуби вже відображаються. “Всі інтактні” додає тільки відсутні зуби та не перезаписує існуючі.');
            return;
        }

        commitStates((prev) => {
            const next = {...prev};
            hidden.forEach((tooth) => {
                next[tooth] = prev[tooth].visible ? cloneToothState(prev[tooth]) : createDefaultToothState(true);
            });
            return next;
        });
        setHoverTooth(null);
        setMessage(`Додано відсутні інтактні зуби: ${hidden.join(', ')}.`);
    }

    function clearMap(force = false) {
        if (readOnly) return;
        if (!force && visibleCount > 0) {
            requestConfirmation(
                'Очистити карту?',
                'Усі додані та відредаговані зуби буде приховано. Залишаться тільки лінії та номери.',
                () => {
                    setConfirmState(null);
                    clearMap(true);
                },
                'Очистити',
            );
            return;
        }

        commitStates(createInitialStates(false));
        setHoverTooth(null);
        setMessage('Карту очищено. Видимі тільки номери та лінії.');
    }

    function applyGlobalPeriodontal(level: PeriodontalLevel) {
        if (readOnly) return;
        const targets = visibleTeeth(states);
        if (!targets.length) {
            setMessage('Спочатку додайте зуби через “Всі інтактні” або “Один інтактний”.');
            return;
        }

        updateTeeth(targets, (state) => ({
            ...state,
            periodontalLevel: level
        }), `Пародонт ${level.toUpperCase()} застосовано до всіх видимих зубів.`);
    }

    function applyGlobalTartar(value: boolean) {
        if (readOnly) return;
        const targets = visibleTeeth(states).filter((tooth) => !states[tooth].absent);
        if (!targets.length) {
            setMessage('Немає видимих присутніх зубів для зубного каменю.');
            return;
        }

        updateTeeth(targets, (state) => ({
            ...state,
            tartar: value
        }), value ? 'Зубний камінь показано на всіх видимих зубах.' : 'Зубний камінь приховано.');
    }

    function overwriteSingleIntact(tooth: number) {
        commitStates((prev) => ({...prev, [tooth]: createDefaultToothState(true)}));
        setMessage(`Зуб ${tooth} додано як інтактний.`);
        setHoverTooth(null);
    }

    function hideToothCompletely(tooth: number) {
        commitStates((prev) => ({...prev, [tooth]: createDefaultToothState(false)}));
        setMessage(`Зуб ${tooth} повністю прибрано зі схеми.`);
        setHoverTooth(null);
    }

    function applyActionToTooth(tooth: number, action: ToolAction, surfaceZone?: SurfaceZone) {
        if (readOnly) return;
        if (!TOOTH_SET.has(tooth)) return;

        if (action.type === 'intact-one') {
            if (states[tooth].visible) {
                requestConfirmation(
                    `Скинути зуб ${tooth}?`,
                    `Поточний стан зуба ${tooth} буде перезаписано та замінено на інтактний.`,
                    () => {
                        setConfirmState(null);
                        overwriteSingleIntact(tooth);
                    },
                    'Скинути зуб',
                );
                return;
            }

            overwriteSingleIntact(tooth);
            return;
        }

        if (action.type === 'hide-tooth') {
            hideToothCompletely(tooth);
            return;
        }

        if (action.type === 'bolt' && states[tooth].absent) {
            setMessage(`Штифт не можна встановити на відсутній зуб ${tooth}.`);
            return;
        }

        const order = nextPaintOrder();

        updateTeeth([tooth], (current) => {
            const state = cloneToothState(current);
            state.visible = true;

            if (action.type === 'absent') {
                state.absent = true;
                state.bolt = false;
                state.crown = null;
                state.periodontitis = 'none';
                state.tartar = false;
                state.cervical = {kind: 'none'};
                state.surfaces = cloneSurfaces(DEFAULT_SURFACES);
            } else if (action.type === 'root') {
                state.rootChanged = action.changed;
                state.bolt = false;
            } else if (action.type === 'bolt') {
                state.absent = false;
                state.bolt = true;
            } else if (action.type === 'canal') {
                state.canalStatus = action.status;
                state.bolt = false;
            } else if (action.type === 'periodontitis') {
                state.absent = false;
                state.periodontitis = action.size;
            } else if (action.type === 'gum') {
                state.gumInflammation = action.inflammation;
            } else if (action.type === 'surface') {
                state.absent = false;
                state.crown = null;
                const zone = surfaceZone || 'front';
                state.surfaces[zone] = {...clonePaint(action.paint), order};
            } else if (action.type === 'cervical') {
                state.absent = false;
                state.cervical = {...clonePaint(action.paint), order};
            } else if (action.type === 'crown') {
                state.absent = false;
                state.crown = action.quality;
            }

            return state;
        }, `Застосовано “${actionLabel(action)}” до зуба ${tooth}.`);

        setHoverTooth(null);
    }

    function handleSvgClick(event: MouseEvent<HTMLDivElement>) {
        if (!pendingAction) {
            const target = event.target as Element | null;
            const element = target?.closest<SVGElement>('[id]') || null;
            const tooth = element ? getToothFromId(sourceIdFromElement(element)) || getToothFromId(element.id) : null;

            if (tooth) {
                onToothSelect?.(tooth);
            }

            return;
        }

        const resolved = resolveActionTarget(event, pendingAction);
        if (!resolved?.tooth) return;

        applyActionToTooth(resolved.tooth, pendingAction, resolved.zone);
    }

    function handleSvgMouseMove(event: MouseEvent<HTMLDivElement>) {
        if (pendingAction?.type !== 'intact-one') {
            if (hoverTooth !== null) setHoverTooth(null);
            return;
        }

        const target = event.target as Element | null;
        const element = target?.closest<SVGElement>('[id]') || null;
        const tooth = element ? getToothFromId(element.id) : null;
        setHoverTooth(tooth);
    }

    function renderToothTools() {
        return (
            <section className="interactive-dental-chart-page__tool-block">
                <div className="interactive-dental-chart-page__tool-head">
                    <h2>Тип зуба</h2>
                    <button type="button" className="interactive-dental-chart-page__ghost-button"
                            onClick={clearAction}>Скинути інструмент
                    </button>
                </div>
                <div className="interactive-dental-chart-page__button-list">
                    <button type="button" className="is-accent" onClick={() => applyAllIntact()}>Всі інтактні</button>
                    <button type="button" className={toolButtonClass({type: 'intact-one'})}
                            onClick={() => setAction({type: 'intact-one'})}>Один інтактний
                    </button>
                    <button type="button" className={toolButtonClass({type: 'absent'})}
                            onClick={() => setAction({type: 'absent'})}>Відсутній зуб
                    </button>
                    <button type="button" className={toolButtonClass({type: 'hide-tooth'})}
                            onClick={() => setAction({type: 'hide-tooth'})}>Прибрати зуб
                    </button>
                    <button type="button" className={toolButtonClass({type: 'root', changed: false})}
                            onClick={() => setAction({type: 'root', changed: false})}>Корінь зуба
                    </button>
                    <button type="button" className={toolButtonClass({type: 'root', changed: true})}
                            onClick={() => setAction({type: 'root', changed: true})}>Змінений у кольорі
                    </button>
                    <button type="button" className="is-danger" onClick={() => clearMap()}>Очистити карту</button>
                </div>
            </section>
        );
    }

    function renderLesionTools() {
        return (
            <section className="interactive-dental-chart-page__tool-block">
                <h2>Ураження</h2>
                <div className="interactive-dental-chart-page__button-list">
                    <button type="button" className={toolButtonClass({
                        type: 'surface',
                        label: 'Фісурна пігментація',
                        paint: {kind: 'fissure'}
                    })} onClick={() => setAction({
                        type: 'surface',
                        label: 'Фісурна пігментація',
                        paint: {kind: 'fissure'}
                    })}>Фісурна пігментація
                    </button>
                    <button type="button"
                            className={toolButtonClass({type: 'surface', label: 'Карієс', paint: {kind: 'caries'}})}
                            onClick={() => setAction({
                                type: 'surface',
                                label: 'Карієс',
                                paint: {kind: 'caries'}
                            })}>Карієс
                    </button>
                    <button type="button" className={toolButtonClass({
                        type: 'cervical',
                        label: 'Пришийковий карієс',
                        paint: {kind: 'cervical-caries'}
                    })} onClick={() => setAction({
                        type: 'cervical',
                        label: 'Пришийковий карієс',
                        paint: {kind: 'cervical-caries'}
                    })}>Пришийковий карієс
                    </button>
                    <button type="button" className={toolButtonClass({
                        type: 'surface',
                        label: 'Очистити область',
                        paint: {kind: 'none'}
                    })} onClick={() => setAction({
                        type: 'surface',
                        label: 'Очистити область',
                        paint: {kind: 'none'}
                    })}>Очистити область
                    </button>
                </div>
            </section>
        );
    }

    function renderPerioTools() {
        return (
            <section className="interactive-dental-chart-page__tool-block">
                <h2>Пародонт</h2>
                <div className="interactive-dental-chart-page__grid-actions">
                    <button type="button" onClick={() => applyGlobalPeriodontal('p0')}>Здоровий пародонт</button>
                    <button type="button" onClick={() => applyGlobalPeriodontal('p1')}>Весь 1 ст</button>
                    <button type="button" onClick={() => applyGlobalPeriodontal('p2')}>Весь 2 ст</button>
                    <button type="button"
                            className={toolButtonClass({type: 'gum', inflammation: 'none', label: 'Без запалення'})}
                            onClick={() => setAction({type: 'gum', inflammation: 'none', label: 'Без запалення'})}>Без
                        запалення
                    </button>
                    <button type="button"
                            className={toolButtonClass({type: 'gum', inflammation: 'mild', label: 'Запалення 1 ст'})}
                            onClick={() => setAction({
                                type: 'gum',
                                inflammation: 'mild',
                                label: 'Запалення 1 ст'
                            })}>Запалення 1 ст
                    </button>
                    <button type="button"
                            className={toolButtonClass({type: 'gum', inflammation: 'medium', label: 'Запалення 2 ст'})}
                            onClick={() => setAction({
                                type: 'gum',
                                inflammation: 'medium',
                                label: 'Запалення 2 ст'
                            })}>Запалення 2 ст
                    </button>
                    <button type="button"
                            className={toolButtonClass({type: 'gum', inflammation: 'severe', label: 'Запалення 3 ст'})}
                            onClick={() => setAction({
                                type: 'gum',
                                inflammation: 'severe',
                                label: 'Запалення 3 ст'
                            })}>Запалення 3 ст
                    </button>
                    <button type="button" onClick={() => applyGlobalTartar(true)}>Зубний камінь</button>
                    <button type="button" onClick={() => applyGlobalTartar(false)}>Без каменю</button>
                </div>
            </section>
        );
    }

    function renderEndoTools() {
        return (
            <section className="interactive-dental-chart-page__tool-block">
                <h2>Endo</h2>
                <div className="interactive-dental-chart-page__button-list">
                    <button type="button" className={toolButtonClass({type: 'canal', status: 'open'})}
                            onClick={() => setAction({type: 'canal', status: 'open'})}>Канал не запломбований
                    </button>
                    <button type="button" className={toolButtonClass({type: 'canal', status: 'filled'})}
                            onClick={() => setAction({type: 'canal', status: 'filled'})}>Канал запломбований
                    </button>
                    <button type="button" className={toolButtonClass({type: 'canal', status: 'partial'})}
                            onClick={() => setAction({type: 'canal', status: 'partial'})}>Канал частково запломбований
                    </button>
                    <button type="button" className={toolButtonClass({type: 'periodontitis', size: '3mm'})}
                            onClick={() => setAction({type: 'periodontitis', size: '3mm'})}>Періодонтит 3мм
                    </button>
                    <button type="button" className={toolButtonClass({type: 'periodontitis', size: '3-5mm'})}
                            onClick={() => setAction({type: 'periodontitis', size: '3-5mm'})}>Періодонтит 3-5мм
                    </button>
                    <button type="button" className={toolButtonClass({type: 'periodontitis', size: '5mm'})}
                            onClick={() => setAction({type: 'periodontitis', size: '5mm'})}>Періодонтит 5мм
                    </button>
                    <button type="button" className={toolButtonClass({type: 'periodontitis', size: 'none'})}
                            onClick={() => setAction({type: 'periodontitis', size: 'none'})}>Без періодонтиту
                    </button>
                </div>
            </section>
        );
    }

    function renderRestorationTools() {
        const filling = (quality: Quality): ToolAction => ({
            type: 'surface',
            label: `Пломба ${readableQuality(quality)}`,
            paint: {kind: 'filling', quality}
        });
        const cervical = (quality: Quality): ToolAction => ({
            type: 'cervical',
            label: `Пришийкова пломба ${readableQuality(quality)}`,
            paint: {kind: 'cervical-filling', quality}
        });
        const crown = (quality: Quality): ToolAction => ({type: 'crown', quality});

        return (
            <section className="interactive-dental-chart-page__tool-block">
                <h2>Конструкції</h2>
                <div className="interactive-dental-chart-page__quality-row">
                    <span>Пломба</span>
                    <button type="button" aria-label="Пломба good"
                            className={`is-good ${isActionSelected(pendingAction, filling('good')) ? 'is-selected' : ''}`.trim()}
                            onClick={() => setAction(filling('good'))}/>
                    <button type="button" aria-label="Пломба medium"
                            className={`is-medium ${isActionSelected(pendingAction, filling('medium')) ? 'is-selected' : ''}`.trim()}
                            onClick={() => setAction(filling('medium'))}/>
                    <button type="button" aria-label="Пломба bad"
                            className={`is-bad ${isActionSelected(pendingAction, filling('bad')) ? 'is-selected' : ''}`.trim()}
                            onClick={() => setAction(filling('bad'))}/>
                </div>
                <div className="interactive-dental-chart-page__quality-row">
                    <span>Пришийкова пломба</span>
                    <button type="button" aria-label="Пришийкова пломба good"
                            className={`is-good ${isActionSelected(pendingAction, cervical('good')) ? 'is-selected' : ''}`.trim()}
                            onClick={() => setAction(cervical('good'))}/>
                    <button type="button" aria-label="Пришийкова пломба medium"
                            className={`is-medium ${isActionSelected(pendingAction, cervical('medium')) ? 'is-selected' : ''}`.trim()}
                            onClick={() => setAction(cervical('medium'))}/>
                    <button type="button" aria-label="Пришийкова пломба bad"
                            className={`is-bad ${isActionSelected(pendingAction, cervical('bad')) ? 'is-selected' : ''}`.trim()}
                            onClick={() => setAction(cervical('bad'))}/>
                </div>
                <div className="interactive-dental-chart-page__quality-row">
                    <span>Коронка</span>
                    <button type="button" aria-label="Коронка good"
                            className={`is-good ${isActionSelected(pendingAction, crown('good')) ? 'is-selected' : ''}`.trim()}
                            onClick={() => setAction(crown('good'))}/>
                    <button type="button" aria-label="Коронка medium"
                            className={`is-medium ${isActionSelected(pendingAction, crown('medium')) ? 'is-selected' : ''}`.trim()}
                            onClick={() => setAction(crown('medium'))}/>
                    <button type="button" aria-label="Коронка bad"
                            className={`is-bad ${isActionSelected(pendingAction, crown('bad')) ? 'is-selected' : ''}`.trim()}
                            onClick={() => setAction(crown('bad'))}/>
                </div>
                <div className="interactive-dental-chart-page__button-list">
                    <button type="button" className={toolButtonClass({type: 'bolt'})}
                            onClick={() => setAction({type: 'bolt'})}>Штифт
                    </button>
                    <button type="button" className={toolButtonClass({
                        type: 'surface',
                        label: 'Очистити ділянку зуба',
                        paint: {kind: 'none'}
                    })} onClick={() => setAction({
                        type: 'surface',
                        label: 'Очистити ділянку зуба',
                        paint: {kind: 'none'}
                    })}>Очистити ділянку зуба
                    </button>
                    <button type="button" className={toolButtonClass({
                        type: 'cervical',
                        label: 'Очистити пришийкову зону',
                        paint: {kind: 'none'}
                    })} onClick={() => setAction({
                        type: 'cervical',
                        label: 'Очистити пришийкову зону',
                        paint: {kind: 'none'}
                    })}>Очистити пришийкову зону
                    </button>
                </div>
            </section>
        );
    }

    function renderSummary() {
        return (
            <section className="interactive-dental-chart-page__summary-panel">
                <h2>Стани</h2>
                {summary.length ? (
                    <ul>
                        {summary.map((row) => (
                            <li key={row.label}>
                                <strong>{row.label}</strong>
                                <span>{row.teeth.join(', ')}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p>Станів ще немає.</p>
                )}
            </section>
        );
    }

    return (
        <main
            className={`interactive-dental-chart-page ${embedded ? 'interactive-dental-chart-page--embedded' : ''} ${className}`}>
            <section className="interactive-dental-chart-page__layout">
                {embedded ? (
                    <>
                        <section className="interactive-dental-chart-page__chart-card">
                            <div className="interactive-dental-chart-page__chart-head">
                                <strong>Видимих зубів: {visibleCount}</strong>
                            </div>

                            <div
                                className={`interactive-dental-chart-page__svg-host ${isSurfacePreciseAction(pendingAction) ? 'is-surface-mode' : ''}`}
                                ref={hostRef}
                                onClick={handleSvgClick}
                                onMouseMove={handleSvgMouseMove}
                                onMouseLeave={() => setHoverTooth(null)}
                            />
                        </section>

                        <aside className="interactive-dental-chart-page__tools">
                            <div className="interactive-dental-chart-page__embedded-tools-grid">
                                <div className="interactive-dental-chart-page__embedded-tools-column">
                                    {renderToothTools()}
                                    {renderLesionTools()}
                                    {renderPerioTools()}
                                </div>

                                <div className="interactive-dental-chart-page__embedded-tools-column">
                                    {renderEndoTools()}
                                    {renderRestorationTools()}
                                </div>
                            </div>

                            <div className="interactive-dental-chart-page__status">
                                <div className="interactive-dental-chart-page__status-head">
                                    <span>Інструмент</span>
                                    {pendingAction ? (
                                        <button
                                            type="button"
                                            className="interactive-dental-chart-page__ghost-button"
                                            onClick={clearAction}
                                        >
                                            Скинути
                                        </button>
                                    ) : null}
                                </div>

                                <strong
                                    className={pendingAction ? 'is-active' : ''}>{actionLabel(pendingAction)}</strong>
                                <p>{message}</p>
                            </div>
                        </aside>

                        <div className="interactive-dental-chart-page__states-under-chart">
                            {renderSummary()}
                        </div>
                    </>
                ) : (
                    <>
                        <aside className="interactive-dental-chart-page__tools">
                            <div className="interactive-dental-chart-page__tabs">
                                {(Object.keys(TOOL_GROUP_LABELS) as ToolGroup[]).map((group) => (
                                    <button
                                        key={group}
                                        type="button"
                                        className={activeGroup === group ? 'is-active' : ''}
                                        onClick={() => setActiveGroup(group)}
                                    >
                                        {TOOL_GROUP_LABELS[group]}
                                    </button>
                                ))}
                            </div>

                            {activeGroup === 'tooth' ? renderToothTools() : null}
                            {activeGroup === 'lesions' ? renderLesionTools() : null}
                            {activeGroup === 'perio' ? renderPerioTools() : null}
                            {activeGroup === 'endo' ? renderEndoTools() : null}
                            {activeGroup === 'restoration' ? renderRestorationTools() : null}
                            {activeGroup === 'summary' ? renderSummary() : null}

                            <div className="interactive-dental-chart-page__status">
                                <div className="interactive-dental-chart-page__status-head">
                                    <span>Інструмент</span>
                                    {pendingAction ? (
                                        <button
                                            type="button"
                                            className="interactive-dental-chart-page__ghost-button"
                                            onClick={clearAction}
                                        >
                                            Скинути
                                        </button>
                                    ) : null}
                                </div>

                                <strong
                                    className={pendingAction ? 'is-active' : ''}>{actionLabel(pendingAction)}</strong>
                                <p>{message}</p>
                            </div>
                        </aside>

                        <section className="interactive-dental-chart-page__chart-card">
                            <div className="interactive-dental-chart-page__chart-head">
                                <strong>Видимих зубів: {visibleCount}</strong>
                                <span>Активний інструмент не зникає після кліку. Його можна змінити в будь-якому розділі або скинути окремою кнопкою.</span>
                            </div>

                            <div
                                className={`interactive-dental-chart-page__svg-host ${isSurfacePreciseAction(pendingAction) ? 'is-surface-mode' : ''}`}
                                ref={hostRef}
                                onClick={handleSvgClick}
                                onMouseMove={handleSvgMouseMove}
                                onMouseLeave={() => setHoverTooth(null)}
                            />
                        </section>
                    </>
                )}
            </section>

            {confirmState ? (
                <div className="interactive-dental-chart-page__modal-backdrop" role="presentation">
                    <div
                        className="interactive-dental-chart-page__modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="dental-chart-confirm-title"
                    >
                        <h3 id="dental-chart-confirm-title">{confirmState.title}</h3>
                        <p>{confirmState.description}</p>

                        <div className="interactive-dental-chart-page__modal-actions">
                            <button type="button" className="is-secondary" onClick={() => setConfirmState(null)}>
                                Скасувати
                            </button>

                            <button
                                type="button"
                                className="is-primary"
                                onClick={() => {
                                    confirmState.onConfirm();
                                }}
                            >
                                {confirmState.confirmLabel || 'Підтвердити'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </main>
    );
}
export default function InteractiveDentalChartPage() {
    return <DentalFormulaEditor />;
}
