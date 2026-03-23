const { evaluateLockTransition, LOCK_STATES, ACTIONS } = require('../../../apps/wf/lib/wf13-lock-machine');

describe('wf13-lock-machine.js - 并发锁状态机核心逻辑', () => {

  // ========== ACQUIRE 动作 ==========

  describe('ACQUIRE (加锁)', () => {
    test('场景 1: 单据空闲时，用户 A 请求加锁 -> 成功分配', () => {
      const current = { status: LOCK_STATES.FREE, owner_id: null };
      const req = { action: ACTIONS.ACQUIRE, requester_id: 'UserA' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(true);
      expect(result.nextStatus).toBe(LOCK_STATES.LOCKED);
      expect(result.nextOwner).toBe('UserA');
    });

    test('场景 2: 脏写防御 - 用户 B 试图抢占用户 A 的锁 -> 失败拦截', () => {
      const current = { status: LOCK_STATES.LOCKED, owner_id: 'UserA' };
      const req = { action: ACTIONS.ACQUIRE, requester_id: 'UserB' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(false);
      expect(result.nextStatus).toBe(LOCK_STATES.LOCKED);
      expect(result.nextOwner).toBe('UserA');
      expect(result.error).toContain('Locked by user: UserA');
    });

    test('场景 3: 锁续期 - 用户 A 重复请求自己的锁 -> 成功保活', () => {
      const current = { status: LOCK_STATES.LOCKED, owner_id: 'UserA' };
      const req = { action: ACTIONS.ACQUIRE, requester_id: 'UserA' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(true);
      expect(result.nextStatus).toBe(LOCK_STATES.LOCKED);
      expect(result.nextOwner).toBe('UserA');
    });

    test('场景 7: currentLock 为 null 时视为 FREE -> 加锁成功', () => {
      const req = { action: ACTIONS.ACQUIRE, requester_id: 'UserA' };
      const result = evaluateLockTransition(null, req);

      expect(result.success).toBe(true);
      expect(result.nextStatus).toBe(LOCK_STATES.LOCKED);
      expect(result.nextOwner).toBe('UserA');
    });

    test('场景 8: currentLock 为 undefined 时视为 FREE -> 加锁成功', () => {
      const req = { action: ACTIONS.ACQUIRE, requester_id: 'UserA' };
      const result = evaluateLockTransition(undefined, req);

      expect(result.success).toBe(true);
      expect(result.nextStatus).toBe(LOCK_STATES.LOCKED);
      expect(result.nextOwner).toBe('UserA');
    });
  });

  // ========== RELEASE 动作 ==========

  describe('RELEASE (释放锁)', () => {
    test('场景 4: 恶意释放 - 用户 B 试图释放用户 A 的锁 -> 失败拦截', () => {
      const current = { status: LOCK_STATES.LOCKED, owner_id: 'UserA' };
      const req = { action: ACTIONS.RELEASE, requester_id: 'UserB' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(false);
      expect(result.nextStatus).toBe(LOCK_STATES.LOCKED);
      expect(result.nextOwner).toBe('UserA');
      expect(result.error).toContain('Permission denied');
    });

    test('场景 9: 正常释放 - 锁持有者释放自己的锁 -> 成功', () => {
      const current = { status: LOCK_STATES.LOCKED, owner_id: 'UserA' };
      const req = { action: ACTIONS.RELEASE, requester_id: 'UserA' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(true);
      expect(result.nextStatus).toBe(LOCK_STATES.FREE);
      expect(result.nextOwner).toBeNull();
    });

    test('场景 10: 幂等释放 - 对已经 FREE 的单据执行 RELEASE -> 安静成功', () => {
      const current = { status: LOCK_STATES.FREE, owner_id: null };
      const req = { action: ACTIONS.RELEASE, requester_id: 'UserA' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(true);
      expect(result.nextStatus).toBe(LOCK_STATES.FREE);
      expect(result.nextOwner).toBeNull();
    });
  });

  // ========== FORCE_UNLOCK 动作 ==========

  describe('FORCE_UNLOCK (强制解锁)', () => {
    test('场景 5: 强制踢人 - 管理员强制释放死锁 -> 成功清空', () => {
      const current = { status: LOCK_STATES.LOCKED, owner_id: 'UserA' };
      const req = { action: ACTIONS.FORCE_UNLOCK, requester_id: 'Admin1' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(true);
      expect(result.nextStatus).toBe(LOCK_STATES.FREE);
      expect(result.nextOwner).toBeNull();
      expect(result.warning).toContain('Forced unlock by Admin1');
    });

    test('场景 11: 对 FREE 状态强制解锁 -> 幂等成功', () => {
      const current = { status: LOCK_STATES.FREE, owner_id: null };
      const req = { action: ACTIONS.FORCE_UNLOCK, requester_id: 'Admin1' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(true);
      expect(result.nextStatus).toBe(LOCK_STATES.FREE);
      expect(result.nextOwner).toBeNull();
    });
  });

  // ========== COMPLETED 终态保护 ==========

  describe('COMPLETED (终态保护)', () => {
    test('场景 6: 终态保护 - 尝试 ACQUIRE 已完结单据 -> 绝对拒绝', () => {
      const current = { status: LOCK_STATES.COMPLETED, owner_id: null };
      const req = { action: ACTIONS.ACQUIRE, requester_id: 'UserA' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(false);
      expect(result.nextStatus).toBe(LOCK_STATES.COMPLETED);
      expect(result.error).toContain('already completed');
    });

    test('场景 12: 终态保护 - 尝试 RELEASE 已完结单据 -> 绝对拒绝', () => {
      const current = { status: LOCK_STATES.COMPLETED, owner_id: 'UserA' };
      const req = { action: ACTIONS.RELEASE, requester_id: 'UserA' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(false);
      expect(result.nextStatus).toBe(LOCK_STATES.COMPLETED);
      expect(result.error).toContain('already completed');
    });

    test('场景 13: 终态保护 - 即使管理员 FORCE_UNLOCK 也无法解锁已完结单据', () => {
      const current = { status: LOCK_STATES.COMPLETED, owner_id: null };
      const req = { action: ACTIONS.FORCE_UNLOCK, requester_id: 'Admin1' };
      const result = evaluateLockTransition(current, req);

      expect(result.success).toBe(false);
      expect(result.nextStatus).toBe(LOCK_STATES.COMPLETED);
      expect(result.error).toContain('already completed');
    });
  });

  // ========== 异常输入防御 ==========

  describe('异常输入防御', () => {
    test('场景 14: request 为 null -> 抛出异常', () => {
      expect(() => evaluateLockTransition(null, null)).toThrow('Invalid request');
    });

    test('场景 15: request 缺少 action -> 抛出异常', () => {
      expect(() => evaluateLockTransition(null, { requester_id: 'UserA' })).toThrow('Invalid request');
    });

    test('场景 16: request 缺少 requester_id -> 抛出异常', () => {
      expect(() => evaluateLockTransition(null, { action: ACTIONS.ACQUIRE })).toThrow('Invalid request');
    });

    test('场景 17: 未知 action -> 抛出异常', () => {
      const req = { action: 'DESTROY', requester_id: 'UserA' };
      expect(() => evaluateLockTransition(null, req)).toThrow('Unknown action: DESTROY');
    });

    test('场景 18: request 为 undefined -> 抛出异常', () => {
      expect(() => evaluateLockTransition(null, undefined)).toThrow('Invalid request');
    });
  });

  // ========== 常量导出验证 ==========

  describe('常量导出', () => {
    test('LOCK_STATES 包含 3 种状态', () => {
      expect(Object.keys(LOCK_STATES)).toHaveLength(3);
      expect(LOCK_STATES).toHaveProperty('FREE');
      expect(LOCK_STATES).toHaveProperty('LOCKED');
      expect(LOCK_STATES).toHaveProperty('COMPLETED');
    });

    test('ACTIONS 包含 3 种动作', () => {
      expect(Object.keys(ACTIONS)).toHaveLength(3);
      expect(ACTIONS).toHaveProperty('ACQUIRE');
      expect(ACTIONS).toHaveProperty('RELEASE');
      expect(ACTIONS).toHaveProperty('FORCE_UNLOCK');
    });
  });
});
