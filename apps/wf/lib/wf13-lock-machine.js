/**
 * wf13 并发锁状态机引擎 (Lock State Machine)
 * 纯函数设计：根据当前数据库锁状态和请求动作，计算出下一个合法状态。
 */

const LOCK_STATES = {
  FREE: 'FREE',
  LOCKED: 'LOCKED',
  COMPLETED: 'COMPLETED' // 单据已完结，永久锁定
};

const ACTIONS = {
  ACQUIRE: 'ACQUIRE',          // 申请加锁 (或续期)
  RELEASE: 'RELEASE',          // 正常释放锁
  FORCE_UNLOCK: 'FORCE_UNLOCK' // 管理员强制解绑
};

/**
 * 评估锁状态转换
 * @param {Object|null} currentLock - 当前数据库锁状态 { status, owner_id }
 * @param {Object} request - 请求 { action, requester_id }
 * @returns {Object} 转换结果 { success, nextStatus, nextOwner, error?, warning? }
 */
function evaluateLockTransition(currentLock, request) {
  if (!request || !request.action || !request.requester_id) {
    throw new Error('Invalid request: Missing action or requester_id');
  }

  // 默认当前无锁状态
  const state = currentLock?.status || LOCK_STATES.FREE;
  const owner = currentLock?.owner_id || null;

  const action = request.action;
  const requester = request.requester_id;

  // 规则 1：已完结的单据绝对不可变更
  if (state === LOCK_STATES.COMPLETED) {
    return {
      success: false,
      nextStatus: state,
      nextOwner: owner,
      error: 'Order is already completed and permanently locked.'
    };
  }

  switch (action) {
    case ACTIONS.ACQUIRE:
      if (state === LOCK_STATES.FREE) {
        // 自由状态，抢锁成功
        return { success: true, nextStatus: LOCK_STATES.LOCKED, nextOwner: requester };
      }
      if (state === LOCK_STATES.LOCKED && owner === requester) {
        // 自己重复请求，视为"心跳保活 / 续期"
        return { success: true, nextStatus: LOCK_STATES.LOCKED, nextOwner: requester };
      }
      // 被别人占用了
      return {
        success: false,
        nextStatus: state,
        nextOwner: owner,
        error: `Locked by user: ${owner}`
      };

    case ACTIONS.RELEASE:
      if (state === LOCK_STATES.LOCKED && owner === requester) {
        // 只能释放自己的锁
        return { success: true, nextStatus: LOCK_STATES.FREE, nextOwner: null };
      }
      if (state === LOCK_STATES.LOCKED && owner !== requester) {
        // 企图释放别人的锁
        return {
          success: false,
          nextStatus: state,
          nextOwner: owner,
          error: 'Permission denied: Cannot release a lock owned by another user.'
        };
      }
      // 本来就是 FREE 的情况，幂等处理
      return { success: true, nextStatus: LOCK_STATES.FREE, nextOwner: null };

    case ACTIONS.FORCE_UNLOCK:
      // 只有高权限动作可以强制踢人
      return {
        success: true,
        nextStatus: LOCK_STATES.FREE,
        nextOwner: null,
        warning: `Forced unlock by ${requester}`
      };

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluateLockTransition, LOCK_STATES, ACTIONS };
}
