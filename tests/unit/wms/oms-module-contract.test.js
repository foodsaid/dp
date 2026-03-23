/**
 * OMS 模块导出契约测试
 * 确保拆分后的模块保持 API 稳定
 */
const { loadSharedJs } = require('./setup');
loadSharedJs();
global.t = function(key, fallback) { return fallback || key; };

const OmsKanban = require('../../../apps/wms/oms-kanban');
const OmsPrint = require('../../../apps/wms/oms-print');

describe('OmsKanban 导出契约', () => {
    const required = ['round4', 'createKanbanState', 'validateDDSplit',
        'parseDocNumInput', 'buildInitItemMap', 'validateMultiSOSubmit',
        'buildMultiSOPayload', 'fmtNum', 'mountDDBoard',
        'checkHasCbmData', 'checkHasWeightData', 'buildSummaryItems', 'buildSourceLabel'];
    required.forEach(function(name) {
        test(name + ' 应为函数', () => {
            expect(typeof OmsKanban[name]).toBe('function');
        });
    });
});

describe('OmsPrint 导出契约', () => {
    const required = ['printBarcodes', 'printOrders', 'isLocked'];
    required.forEach(function(name) {
        test(name + ' 应为函数', () => {
            expect(typeof OmsPrint[name]).toBe('function');
        });
    });

    test('_STYLES 应为冻结对象', () => {
        expect(OmsPrint._STYLES).toBeDefined();
        expect(Object.isFrozen(OmsPrint._STYLES)).toBe(true);
    });
});
