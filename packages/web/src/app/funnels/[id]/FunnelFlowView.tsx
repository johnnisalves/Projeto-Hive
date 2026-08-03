'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Plus, Trash2, Check, ArrowRight, Globe, Mail, ShoppingCart, Video,
  FileText, Megaphone, Zap, MoreHorizontal, ExternalLink, Pencil, X,
} from 'lucide-react';

const STEP_TYPE_LABELS: Record<string, string> = {
  LANDING_PAGE: 'Landing Page',
  LEAD_CAPTURE: 'Captura de Lead',
  EMAIL_SEQUENCE: 'Sequencia de Emails',
  SALES_PAGE: 'Pagina de Vendas',
  CHECKOUT: 'Checkout',
  UPSELL: 'Upsell',
  THANK_YOU: 'Obrigado',
  WEBINAR: 'Webinar',
  VIDEO: 'Video',
  SOCIAL_POST: 'Post Social',
  AD: 'Anuncio',
  OTHER: 'Outro',
};

const STEP_TYPE_ICONS: Record<string, any> = {
  LANDING_PAGE: Globe, LEAD_CAPTURE: FileText, EMAIL_SEQUENCE: Mail,
  SALES_PAGE: ShoppingCart, CHECKOUT: ShoppingCart, UPSELL: Zap,
  THANK_YOU: Check, WEBINAR: Video, VIDEO: Video,
  SOCIAL_POST: Megaphone, AD: Megaphone, OTHER: MoreHorizontal,
};

const STAGE_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];

export interface FunnelFlowViewProps {
  funnel: any;
  onAddStage: (title: string, color: string) => Promise<void>;
  onDeleteStage: (stageId: string) => void;
  onAddStep: (stageId: string, title: string, type: string) => Promise<void>;
  onDeleteStep: (stageId: string, stepId: string) => void;
  onToggleStepStatus: (stageId: string, stepId: string, currentStatus: string) => void;
  onEditStep: (stageId: string, stepId: string, data: any) => Promise<void>;
  onMoveStep: (stepId: string, sourceStageId: string, targetStageId: string) => Promise<void>;
}

// ── Custom Node: Stage ──
function StageNodeComponent({ data }: { data: any }) {
  return (
    <div className="rounded-xl border-2 shadow-sm bg-bg-card min-w-[250px]" style={{ borderColor: data.color }}>
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !border-2 !border-white" style={{ background: data.color }} />
      <div className="px-4 py-3 rounded-t-[10px] flex items-center justify-between" style={{ backgroundColor: data.color + '18' }}>
        <div className="flex items-center gap-2">
          <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: data.color }} />
          <span className="font-bold text-sm text-text-primary">{data.title}</span>
          <span className="text-xs text-text-muted">({data.stepCount})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); data.onAddStep(); }}
            className="p-1 rounded text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
            className="p-1 rounded text-text-muted hover:text-status-failed hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <div className="px-4 py-1.5">
        <div className="w-full h-1.5 bg-bg-card-hover rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${data.progress}%`, backgroundColor: data.color }} />
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !border-2 !border-white" style={{ background: data.color }} />
    </div>
  );
}

// ── Custom Node: Step ──
function StepNodeComponent({ data }: { data: any }) {
  const StepIcon = STEP_TYPE_ICONS[data.type] || MoreHorizontal;
  const statusColors: Record<string, string> = {
    TODO: 'border-gray-300',
    IN_PROGRESS: 'bg-blue-500 border-blue-500 text-white',
    DONE: 'bg-green-500 border-green-500 text-white',
  };

  return (
    <div className="rounded-lg border border-border bg-bg-card shadow-sm min-w-[230px] hover:border-primary/30 transition-colors group">
      <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !border-2 !border-white !bg-gray-400" />
      <div className="p-3">
        <div className="flex items-start gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); data.onToggleStatus(); }}
            className={`mt-0.5 w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border transition-colors ${statusColors[data.status] || statusColors.TODO}`}
          >
            {data.status === 'DONE' && <Check className="w-3 h-3" />}
            {data.status === 'IN_PROGRESS' && <ArrowRight className="w-3 h-3" />}
          </button>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-semibold ${data.status === 'DONE' ? 'line-through text-text-muted' : 'text-text-primary'}`}>
              {data.title}
            </p>
            {data.description && (
              <p className="text-[10px] text-text-muted mt-0.5 line-clamp-1">{data.description}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center gap-0.5 text-[10px] text-text-muted">
                <StepIcon className="w-3 h-3" />
                {STEP_TYPE_LABELS[data.type]}
              </span>
              {data.link && (
                <a href={data.link} target="_blank" rel="noopener noreferrer" className="text-primary" onClick={(e) => e.stopPropagation()}>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); data.onEdit(); }}
              className="p-1 rounded text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); data.onDelete(); }}
              className="p-1 rounded text-text-muted hover:text-status-failed hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !border-2 !border-white !bg-gray-400" />
    </div>
  );
}

const nodeTypes = {
  stage: StageNodeComponent,
  step: StepNodeComponent,
};

// ── Build nodes/edges from funnel data, preserving dragged positions ──
function buildNodesAndEdges(
  funnel: any,
  callbacks: {
    onDeleteStage: (id: string) => void;
    onAddStepToStage: (stageId: string) => void;
    onDeleteStep: (stageId: string, stepId: string) => void;
    onToggleStepStatus: (stageId: string, stepId: string, status: string) => void;
    onEditStep: (stageId: string, stepId: string) => void;
  },
  positionMap: Map<string, { x: number; y: number }>,
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const STAGE_GAP_X = 350;
  const STEP_OFFSET_Y = 100;
  const STEP_GAP_Y = 90;
  const STAGE_Y = 50;

  funnel.stages.forEach((stage: any, stageIdx: number) => {
    const stageSteps = stage.steps || [];
    const stageDone = stageSteps.filter((s: any) => s.status === 'DONE').length;
    const stageProgress = stageSteps.length > 0 ? Math.round((stageDone / stageSteps.length) * 100) : 0;
    const defaultX = stageIdx * STAGE_GAP_X;
    const stageNodeId = `stage-${stage.id}`;

    nodes.push({
      id: stageNodeId,
      type: 'stage',
      position: positionMap.get(stageNodeId) ?? { x: defaultX, y: STAGE_Y },
      data: {
        title: stage.title,
        color: stage.color,
        stepCount: stageSteps.length,
        progress: stageProgress,
        onDelete: () => callbacks.onDeleteStage(stage.id),
        onAddStep: () => callbacks.onAddStepToStage(stage.id),
      },
    });

    if (stageIdx < funnel.stages.length - 1) {
      const nextStage = funnel.stages[stageIdx + 1];
      edges.push({
        id: `edge-stage-${stage.id}-${nextStage.id}`,
        source: stageNodeId,
        target: `stage-${nextStage.id}`,
        type: 'smoothstep',
        style: { stroke: stage.color, strokeWidth: 2 },
        animated: true,
      });
    }

    stageSteps.forEach((step: any, stepIdx: number) => {
      const stepNodeId = `step-${step.id}`;
      nodes.push({
        id: stepNodeId,
        type: 'step',
        position: positionMap.get(stepNodeId) ?? { x: defaultX + 10, y: STAGE_Y + STEP_OFFSET_Y + stepIdx * STEP_GAP_Y },
        data: {
          title: step.title,
          description: step.description,
          type: step.type,
          status: step.status,
          link: step.link,
          onToggleStatus: () => callbacks.onToggleStepStatus(stage.id, step.id, step.status),
          onDelete: () => callbacks.onDeleteStep(stage.id, step.id),
          onEdit: () => callbacks.onEditStep(stage.id, step.id),
        },
      });

      if (stepIdx === 0) {
        edges.push({
          id: `edge-stage-step-${stage.id}-${step.id}`,
          source: stageNodeId,
          target: stepNodeId,
          type: 'smoothstep',
          style: { stroke: stage.color + '80', strokeWidth: 1.5 },
        });
      } else {
        const prevStep = stageSteps[stepIdx - 1];
        edges.push({
          id: `edge-step-${prevStep.id}-${step.id}`,
          source: `step-${prevStep.id}`,
          target: stepNodeId,
          type: 'smoothstep',
          style: { stroke: '#d1d5db', strokeWidth: 1 },
        });
      }
    });
  });

  return { nodes, edges };
}

// ── Main Flow Component ──
function FunnelFlowInner({
  funnel,
  onAddStage,
  onDeleteStage,
  onAddStep,
  onDeleteStep,
  onToggleStepStatus,
  onEditStep,
  onMoveStep,
}: FunnelFlowViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const positionMapRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Inline form states
  const [showAddStage, setShowAddStage] = useState(false);
  const [stageTitle, setStageTitle] = useState('');
  const [stageColor, setStageColor] = useState('#6366f1');
  const [showAddStep, setShowAddStep] = useState<string | null>(null);
  const [stepTitle, setStepTitle] = useState('');
  const [stepType, setStepType] = useState('OTHER');

  // Edit step state
  const [editingStep, setEditingStep] = useState<{ stageId: string; stepId: string } | null>(null);
  const [editData, setEditData] = useState<any>({});

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number; y: number; nodeId: string; nodeType: 'stage' | 'step'; stageId: string;
  } | null>(null);

  const openEditStep = useCallback((stageId: string, stepId: string) => {
    const stage = funnel.stages.find((s: any) => s.id === stageId);
    const step = stage?.steps.find((st: any) => st.id === stepId);
    if (step) {
      setEditData({ title: step.title, description: step.description || '', link: step.link || '', type: step.type });
      setEditingStep({ stageId, stepId });
    }
  }, [funnel]);

  // Sync nodes/edges from funnel data, preserving dragged positions
  useEffect(() => {
    nodes.forEach((n) => {
      positionMapRef.current.set(n.id, { ...n.position });
    });

    const { nodes: newNodes, edges: newEdges } = buildNodesAndEdges(
      funnel,
      {
        onDeleteStage,
        onAddStepToStage: (stageId: string) => setShowAddStep(stageId),
        onDeleteStep,
        onToggleStepStatus,
        onEditStep: openEditStep,
      },
      positionMapRef.current,
    );
    setNodes(newNodes);
    setEdges(newEdges);
  }, [funnel]);

  const onNodeDragStop = useCallback((_event: React.MouseEvent, node: Node) => {
    positionMapRef.current.set(node.id, { ...node.position });
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    const { source, target } = connection;
    if (!source || !target) return;

    // Step -> Stage = move step to another stage
    if (source.startsWith('step-') && target.startsWith('stage-')) {
      const stepId = source.replace('step-', '');
      const targetStageId = target.replace('stage-', '');
      const currentStage = funnel.stages.find((s: any) =>
        s.steps.some((st: any) => st.id === stepId),
      );
      if (currentStage && currentStage.id !== targetStageId) {
        onMoveStep(stepId, currentStage.id, targetStageId);
      }
      return;
    }

    // Visual-only edge for other connections
    setEdges((eds) => addEdge({ ...connection, type: 'smoothstep', animated: true }, eds));
  }, [funnel, onMoveStep, setEdges]);

  const onPaneClick = useCallback(() => setContextMenu(null), []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    const nodeType = node.type as 'stage' | 'step';
    let stageId: string;
    if (nodeType === 'stage') {
      stageId = node.id.replace('stage-', '');
    } else {
      const stepId = node.id.replace('step-', '');
      const stage = funnel.stages.find((s: any) => s.steps.some((st: any) => st.id === stepId));
      stageId = stage?.id || '';
    }
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, nodeType, stageId });
  }, [funnel]);

  async function handleCreateStage() {
    if (!stageTitle.trim()) return;
    await onAddStage(stageTitle.trim(), stageColor);
    setStageTitle('');
    setShowAddStage(false);
  }

  async function handleCreateStep() {
    if (!stepTitle.trim() || !showAddStep) return;
    await onAddStep(showAddStep, stepTitle.trim(), stepType);
    setStepTitle('');
    setStepType('OTHER');
    setShowAddStep(null);
  }

  async function handleSaveEdit() {
    if (!editingStep) return;
    await onEditStep(editingStep.stageId, editingStep.stepId, editData);
    setEditingStep(null);
  }

  return (
    <div className="w-full rounded-xl border border-border bg-bg-card overflow-hidden relative" style={{ height: '70vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#f0efec" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          nodeColor={(node) => {
            // `node.data` e tipado como desconhecido pelo React Flow, entao a
            // cor precisa sair daqui como string — o minimapa nao aceita
            // outra coisa.
            if (node.type === 'stage') return String((node.data as { color?: string })?.color || '#6366f1');
            return '#e5e7eb';
          }}
          maskColor="rgba(255,255,255,0.8)"
          position="bottom-left"
        />
        <Panel position="top-left" className="flex gap-2">
          <button
            onClick={() => setShowAddStage(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-card border border-border shadow-sm text-sm font-medium text-text-primary hover:border-primary/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nova Etapa
          </button>
          <button
            onClick={() => { if (funnel.stages.length > 0) setShowAddStep(funnel.stages[0].id); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-card border border-border shadow-sm text-sm font-medium text-text-primary hover:border-primary/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Passo
          </button>
        </Panel>
      </ReactFlow>

      {/* Context Menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)}>
          <div
            className="absolute bg-bg-card rounded-lg border border-border shadow-lg py-1 min-w-[160px] z-50"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.nodeType === 'step' && (
              <button
                onClick={() => {
                  openEditStep(contextMenu.stageId, contextMenu.nodeId.replace('step-', ''));
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-main flex items-center gap-2"
              >
                <Pencil className="w-3.5 h-3.5" /> Editar
              </button>
            )}
            {contextMenu.nodeType === 'stage' && (
              <button
                onClick={() => {
                  setShowAddStep(contextMenu.stageId);
                  setContextMenu(null);
                }}
                className="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-bg-main flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5" /> Adicionar Passo
              </button>
            )}
            <button
              onClick={() => {
                if (contextMenu.nodeType === 'stage') {
                  onDeleteStage(contextMenu.stageId);
                } else {
                  onDeleteStep(contextMenu.stageId, contextMenu.nodeId.replace('step-', ''));
                }
                setContextMenu(null);
              }}
              className="w-full px-3 py-2 text-left text-sm text-status-failed hover:bg-red-500/10 flex items-center gap-2"
            >
              <Trash2 className="w-3.5 h-3.5" /> Excluir
            </button>
          </div>
        </div>
      )}

      {/* Modal: Add Stage */}
      {showAddStage && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowAddStage(false)}>
          <div className="card p-5 w-80 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-text-primary">Nova Etapa</h3>
              <button onClick={() => setShowAddStage(false)} className="p-1 text-text-muted hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              value={stageTitle}
              onChange={(e) => setStageTitle(e.target.value)}
              className="input-field text-sm"
              placeholder="Nome da etapa"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateStage()}
            />
            <div>
              <label className="block text-xs text-text-muted mb-1">Cor</label>
              <div className="flex gap-2 flex-wrap">
                {STAGE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setStageColor(c)}
                    className={`w-7 h-7 rounded-full border-2 transition-all ${stageColor === c ? 'border-text-primary scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreateStage} className="flex-1 btn-cta text-sm justify-center">Criar</button>
              <button onClick={() => { setShowAddStage(false); setStageTitle(''); }} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Step */}
      {showAddStep && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowAddStep(null)}>
          <div className="card p-5 w-80 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-text-primary">Novo Passo</h3>
              <button onClick={() => setShowAddStep(null)} className="p-1 text-text-muted hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Etapa</label>
              <select value={showAddStep} onChange={(e) => setShowAddStep(e.target.value)} className="input-field text-sm">
                {funnel.stages.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>
            <input
              value={stepTitle}
              onChange={(e) => setStepTitle(e.target.value)}
              className="input-field text-sm"
              placeholder="Nome do passo"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreateStep()}
            />
            <select value={stepType} onChange={(e) => setStepType(e.target.value)} className="input-field text-sm">
              {Object.entries(STEP_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={handleCreateStep} className="flex-1 btn-cta text-sm justify-center">Adicionar</button>
              <button onClick={() => { setShowAddStep(null); setStepTitle(''); }} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Step */}
      {editingStep && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setEditingStep(null)}>
          <div className="card p-5 w-96 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-text-primary">Editar Passo</h3>
              <button onClick={() => setEditingStep(null)} className="p-1 text-text-muted hover:text-text-primary">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              value={editData.title || ''}
              onChange={(e) => setEditData({ ...editData, title: e.target.value })}
              className="input-field text-sm"
              placeholder="Titulo"
              autoFocus
            />
            <textarea
              value={editData.description || ''}
              onChange={(e) => setEditData({ ...editData, description: e.target.value })}
              className="input-field text-sm min-h-[60px]"
              placeholder="Descricao (opcional)"
            />
            <input
              value={editData.link || ''}
              onChange={(e) => setEditData({ ...editData, link: e.target.value })}
              className="input-field text-sm"
              placeholder="Link (opcional)"
            />
            <select
              value={editData.type || 'OTHER'}
              onChange={(e) => setEditData({ ...editData, type: e.target.value })}
              className="input-field text-sm"
            >
              {Object.entries(STEP_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={handleSaveEdit} className="flex-1 btn-cta text-sm justify-center">Salvar</button>
              <button onClick={() => setEditingStep(null)} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FunnelFlowView(props: FunnelFlowViewProps) {
  return (
    <ReactFlowProvider>
      <FunnelFlowInner {...props} />
    </ReactFlowProvider>
  );
}
