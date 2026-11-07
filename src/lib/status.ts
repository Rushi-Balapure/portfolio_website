export type ProjectStatus = 'planned' | 'in-progress' | 'completed' | 'maintained' | 'archived' | 'live';

const labels: Record<ProjectStatus, string> = {
  planned: 'Planned',
  'in-progress': 'In progress',
  completed: 'Completed',
  maintained: 'Maintained',
  archived: 'Archived',
  live: 'Live · Open source',
};

export const statusLabel = (status?: ProjectStatus) => (status ? labels[status] : undefined);
