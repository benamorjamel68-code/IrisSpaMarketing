// In-memory stand-in for the Base44 SDK client used by backend functions.
// Implements the subset the handlers use: auth.me, entities.*.{get,list,filter,create,update,bulkCreate,deleteMany},
// integrations.Core.InvokeLLM.

function matches(rec, query) {
  return Object.entries(query || {}).every(([k, v]) => rec[k] === v);
}

export function fakeBase44(seed = {}, { user = { id: 'u1', role: 'admin' }, llm } = {}) {
  const tables = {};
  let seq = 0;
  const table = (name) => {
    if (!tables[name]) tables[name] = (seed[name] || []).map((r) => ({ ...r }));
    return tables[name];
  };
  const handler = (name) => ({
    async get(id) {
      const r = table(name).find((x) => x.id === id);
      if (!r) throw new Error('not found');
      return { ...r };
    },
    async list() { return table(name).map((r) => ({ ...r })); },
    async filter(q) { return table(name).filter((r) => matches(r, q)).map((r) => ({ ...r })); },
    async create(data) { const r = { id: `${name}-${(seq += 1)}`, ...data }; table(name).push(r); return { ...r }; },
    async bulkCreate(rows) { return Promise.all(rows.map((r) => this.create(r))); },
    async update(id, data) {
      const r = table(name).find((x) => x.id === id);
      if (!r) throw new Error(`${name} ${id} not found`);
      Object.assign(r, data);
      return { ...r };
    },
    async deleteMany(q) {
      const before = table(name).length;
      tables[name] = table(name).filter((r) => !matches(r, q));
      return { deleted: before - tables[name].length };
    },
  });
  const entities = new Proxy({}, { get: (_, name) => handler(name) });
  const llmCalls = [];
  const client = {
    auth: { me: async () => { if (!user) throw new Error('401'); return user; } },
    asServiceRole: {
      entities,
      integrations: { Core: { InvokeLLM: async (params) => { llmCalls.push(params); if (!llm) throw new Error('no llm'); return llm(params); } } },
    },
    tables,
    table,
    llmCalls,
  };
  return client;
}
