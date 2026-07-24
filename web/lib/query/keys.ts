export const queryKeys = {
  projects: {
    all: ['projects'] as const,
    list: (page: number, status?: string) => ['projects', 'list', { page, status }] as const,
    detail: (id: string) => ['projects', 'detail', id] as const,
  },
  equipment: {
    all: ['equipment'] as const,
    list: (page: number, category?: string) => ['equipment', 'list', { page, category }] as const,
  },
  dockets: {
    all: ['dockets'] as const,
    list: (page: number, filters?: Record<string, string | undefined>) =>
      ['dockets', 'list', { page, ...filters }] as const,
  },
  notes: {
    forEntity: (entityType: string, entityId: string) => ['notes', entityType, entityId] as const,
  },
  reports: {
    burn: ['reports', 'burn'] as const,
  },
  users: {
    all: ['users'] as const,
  },
};
