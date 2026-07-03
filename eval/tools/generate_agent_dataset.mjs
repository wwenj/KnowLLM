#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const datasetDir = path.resolve(process.argv[2] || "eval/zh_klipper3d_manual_mini");
const compileFile = path.join(datasetDir, "compile_cases.json");
const outputFile = path.join(datasetDir, "agent_cases.json");

const compile = JSON.parse(fs.readFileSync(compileFile, "utf8"));
const factById = new Map(
  compile.cases.flatMap((testCase) =>
    testCase.expectedFacts.map((fact) => [fact.id, fact]),
  ),
);

const definitions = [
  caseDef("安装配置反复报错时，应如何选择配置模板并确认 Klipper 已恢复就绪？", ["C001-F01", "C001-F03", "C001-F04"], ["打印机配置文件", "restart", "status"], "troubleshooting"),
  caseDef("步进轴无法自由移动，或移动后不能回到原位时，应分别检查哪些配置，并如何确认限位状态？", ["C002-F01", "C002-F04", "C002-F05"], ["enable_pin", "dir_pin", "打开"], "troubleshooting"),
  caseDef("使用纸张测试校准打印床时，测试层高、床面材料和 Z 轴下限需要注意什么？", ["C003-F01", "C003-F02", "C003-F04"], ["75%", "position_min", "胶带"], "calibration_procedure"),
  caseDef("使用 SCREWS_TILT_CALCULATE 调平床身时，如何理解调整时间，ADJUSTED 何时使用，收敛标准是什么？", ["C004-F01", "C004-F02", "C004-F05"], ["时钟上的分钟", "ADJUSTED", "6分钟"], "calibration_procedure"),
  caseDef("如何使用 PROBE_CALIBRATE 获得 Z 偏移，哪些情况下必须重新校准，重复性不合格时怎么办？", ["C005-F02", "C005-F04", "C005-F05"], ["PROBE_CALIBRATE", "重新测量", "自动热床调平"], "calibration_procedure"),
  caseDef("增强型三角洲校准前必须完成哪些步骤，之后哪些操作会让已有校准结果失效？", ["C006-F02", "C006-F03", "C006-F04"], ["DELTA_CALIBRATE", "SAVE_CONFIG", "模型测量无效"], "calibration_procedure"),
  caseDef("床网的 probe_count 和 mesh_pps 应如何理解，怎样配置方形网格，以及何时会禁用插值？", ["C007-F01", "C007-F03", "C007-F05"], ["probe_count", "mesh_pps", "网格插值"], "config_query"),
  caseDef("配置 BL-Touch 的 touch mode 和收针行为时，需要兼顾哪些兼容性、精度与 EEPROM 风险？", ["C008-F01", "C008-F03", "C008-F04", "C008-F06"], ["probe_with_touch_mode", "EEPROM", "stow_on_each_sample"], "safety_constraint"),
  caseDef("调试 TMC 无传感器归位时，轴未到极限、无法停止和低速失效分别意味着什么，应采取什么安全措施？", ["C009-F01", "C009-F02", "C009-F03", "C009-F04"], ["M112", "10RPM", "M84"], "troubleshooting"),
  caseDef("压力提前校准需要满足什么前置条件，怎样写入结果并重启，哪些现象说明设置可能过大？", ["C010-F01", "C010-F02", "C010-F04", "C010-F06"], ["pressure_advance", "1.000", "RESTART"], "calibration_procedure"),
  caseDef("选择输入整形器时，2HUMP_EI 的适用条件、EI 的平滑风险和低共振频率应如何处理？", ["C011-F01", "C011-F02", "C011-F03", "C011-F05"], ["2HUMP_EI", "EI整形器", "20-25 Hz"], "calibration_procedure"),
  caseDef("进行共振测量和输入整形自动调优时，为什么不建议 ADXL345 使用 I2C，max_accel 如何设置，调优脚本怎样使用？", ["C012-F01", "C012-F02", "C012-F03", "C012-F05"], ["I2C", "max_accel", "Shaper_calbrate.py"], "calibration_procedure"),
  caseDef("配置 rotation_distance 时，full_steps_per_rotation 和 gear_ratio 在不确定时应如何处理，齿轮挤出机还需要什么？", ["C013-F01", "C013-F02", "C013-F04", "C013-F06"], ["rotation_distance", "full_steps_per_rotation", "gear_ratio"], "config_query"),
  caseDef("启用偏斜校正前后应先做哪些机械和 G-Code 处理，并如何避免打印边界问题？", ["C014-F01", "C014-F02", "C014-F03", "C014-F04"], ["SET_SKEW CLEAR=1", "机械手段", "打印机边缘"], "calibration_procedure"),
  caseDef("endstop phase 功能有哪些运动学限制，出现 incorrect phase 错误时说明什么，校准命令顺序是什么？", ["C015-F01", "C015-F03", "C015-F04", "C015-F06"], ["Endstop stepper_z incorrect phase", "trigger_phase", "ENDSTOP_PHASE_CALIBRATE"], "troubleshooting"),
  caseDef("搭建 Klipper CAN 总线时，终端电阻如何配置和核验，canbus_query.py 为什么可能找不到设备？", ["C016-F01", "C016-F04", "C016-F05", "C016-F06"], ["canbus_query.py", "120 欧姆", "make menuconfig"], "config_query"),
  caseDef("CAN 通信出现间歇错误时，txqueuelen 应怎样调整，队列过大有什么风险，还应检查哪些物理布线问题？", ["C017-F01", "C017-F02", "C017-F04", "C017-F05"], ["txqueuelen 128", "5 个或更多", "间歇性通信错误"], "troubleshooting"),
  caseDef("为控制板选择和刷写引导程序时，57600 波特率、SD 卡更新限制和 STM32 刷写工具需要注意什么？", ["C018-F02", "C018-F03", "C018-F04", "C018-F05"], ["57600", "SD卡更新固件", "ST-Link"], "safety_constraint"),
  caseDef("通过 CAN 请求进入 BootLoader 时，DFU 模式有什么硬件风险，消息格式和接口参数有哪些约束，怎样提高可靠性？", ["C019-F01", "C019-F02", "C019-F04", "C019-F06"], ["DFU模式", "有效的消息", "can0", "同步字符"], "command_usage"),
  caseDef("使用 flash-sdcard 工具时，SDIO 控制板、SPI 引脚、默认波特率和只验证模式分别有什么要求？", ["C020-F02", "C020-F03", "C020-F04", "C020-F06"], ["SDIO", "spi_pins", "250000", "-c"], "config_query"),
  caseDef("把树莓派作为 Klipper 辅助 MCU 时，权限、I2C 速率、GPIO 使用范围和进程启动顺序有哪些要求？", ["C021-F01", "C021-F02", "C021-F05", "C021-F06"], ["Permission denied", "400000", "unused", "klipper_mcu"], "config_query"),
  caseDef("OctoPrint 连接 Klipper 前后应检查哪些条件，连接成功后如何验证，安装过程还有什么网络要求？", ["C022-F01", "C022-F02", "C022-F03", "C022-F05"], ["OctoPrint", "status", "互联网连接"], "config_query"),
  caseDef("为 Klipper 配置切片软件时，KISSlicer 的 PreloadVE、开始结束动作、自动加热代码和大回抽值应如何处理？", ["C023-F02", "C023-F03", "C023-F04", "C023-F06"], ["PreloadVE", "开始和结束步骤", "5毫米"], "config_query"),
  caseDef("Klipper 中 FIRMWARE_RESTART、加速度计连接测试和 ANGLE_CALIBRATE 分别用于什么场景？", ["C024-F02", "C024-F05", "C024-F06"], ["FIRMWARE_RESTART", "ADXL345", "ANGLE_CALIBRATE"], "command_usage"),
  caseDef("配置 I2C、Palette 2、SX1509 和具名 ADXL345 时有哪些明确限制？", ["C025-F01", "C025-F02", "C025-F05", "C025-F06"], ["I2C", "Palette 2", "SX1509", "adxl345"], "safety_constraint"),
  caseDef("在宏中读取探针和配置状态时，PROBE、QUERY_PROBE、settings 与 heater power 字段分别有什么使用约束？", ["C027-F02", "C027-F03", "C027-F04", "C027-F06"], ["PROBE", "QUERY_PROBE", "settings.", "power"], "config_query"),
  caseDef("Klipper 常见故障排查中，USB 5V、主机高负载、电机禁用和空载运动测试分别应注意什么？", ["C028-F02", "C028-F03", "C028-F05", "C028-F06"], ["5V电源", "密集型", "M84", "GET_POSITION"], "troubleshooting"),
  caseDef("Klipper 对本地显示器、现有 RepRap 硬件、TMC 驱动器和微控制器执行时间表提供了哪些能力？", ["C029-F01", "C029-F02", "C029-F05", "C029-F06"], ["LCD", "树莓派", "TMC2209", "时间表"], "architecture"),
  caseDef("调用 Klipper API 时，如何识别错误响应，消息分隔符怎样处理，端点 method 又应如何填写？", ["C031-F03", "C031-F04", "C031-F05", "C031-F06"], ["error", "0x03", "gcode/restart"], "api_contract"),
  caseDef("在 BeagleBone 上部署 Klipper 时，电平、remoteproc、OctoPrint 配置和外部 MCU 连接有哪些关键要求？", ["C032-F01", "C032-F02", "C032-F03", "C032-F05"], ["3.3v", "remoteproc", "OctoPrint", "串行/usb/canbus"], "deployment"),
  caseDef("执行 MCU 步进率基准测试时，ticks 过低如何识别，为什么结果不能直接用于日常运行，怎样启用双边沿优化？", ["C033-F01", "C033-F03", "C033-F04", "C033-F05"], ["ticks", "日常使用", "STEPPER_BOTH_EDGE"], "troubleshooting"),
  caseDef("Klipper CANBUS 协议如何处理字节流、管理消息 ID、节点消息 ID 和广播地址？", ["C034-F01", "C034-F03", "C034-F05", "C034-F06"], ["byte stream", "0x3f0", "canbus_nodeid", "广播地址"], "architecture"),
  caseDef("开发 Klipper 主机模块时，配置错误、get_status 返回值和 reactor 访问分别有什么约束？", ["C035-F02", "C035-F04", "C035-F05", "C035-F06"], ["load_config()", "get_status()", "Python字典", "printer.get_reactor()"], "development_constraint"),
  caseDef("编写 Klipper G-Code 宏时，Jinja2 默认参数、gcode 缩进、远程方法参数和宏命名有哪些规则？", ["C036-F02", "C036-F03", "C036-F04", "C036-F06"], ["Jinja2", "gcode:", "action_call_remote_method", "TEST_MACRO25"], "development_constraint"),
  caseDef("提交 Klipper 问题报告前应怎样复现问题、处理日志，并向贡献者说明哪些信息？", ["C037-F02", "C037-F03", "C037-F05", "C037-F06"], ["未修改的代码", "不要以任何方式修改日志文件", "期望的结果", "实际发生的结果"], "troubleshooting"),
  caseDef("向 Klipper 贡献代码时，评审标准、配置选项价值、第三方许可证和用户文档有哪些要求？", ["C038-F02", "C038-F03", "C038-F05", "C038-F06"], ["缺陷", "显著好处", "GNU GPLv3", "Config_Reference.md"], "development_constraint"),
  caseDef("校准 Eddy 探针及其温度漂移时，STEP、TARGET、校准命令和 z_offset 应如何设置？", ["C040-F01", "C040-F03", "C040-F04", "C040-F06"], ["STEP", "TEMPERATURE_PROBE_CALIBRATE", "PROBE_EDDY_CURRENT_CALIBRATE", "0.5mm"], "calibration_procedure"),
  caseDef("编写 Klipper 配置示例时，字段语法、文件扩展名、pressure_advance 和默认值应遵循什么规范？", ["C041-F01", "C041-F02", "C041-F03", "C041-F04"], ["field: value", ".cfg", "pressure_advance", "min_extrude_temp"], "development_constraint"),
  caseDef("配置霍尔耗材线径传感器时，如何记录原始值、启用传感器、查询原始读数，以及为什么不需要温度补偿？", ["C043-F01", "C043-F02", "C043-F04", "C043-F06"], ["Raw_dia1", "差分模式", "ENABLE_FILAMENT_WIDTH_SENSOR", "QUERY_RAW_FILAMENT_WIDTH"], "config_query"),
  caseDef("多 MCU 归位时，步进电机归属、通信延迟、故障表现和接线收益分别是什么？", ["C046-F01", "C046-F03", "C046-F04", "C046-F06"], ["同一微控制器", "复位期间通信超时", "可预测的低延迟", "简化接线"], "architecture"),
  caseDef("Klipper 主机与 MCU 通信协议对 sendf 调用、损坏块重传、命令 ID 和数据字典有哪些约束？", ["C048-F01", "C048-F03", "C048-F05", "C048-F06"], ["sendf()", "nak message block", "命令的ID", "数据字典"], "architecture"),
  caseDef("使用 Klipper 控制激光或主轴时，应设置哪些安全措施，M3/M4/M5 如何使用，PWM 频率有什么局限？", ["C051-F01", "C051-F03", "C051-F04", "C051-F06"], ["安全定时", "M3 S[0-255]", "护目镜", "0.1秒"], "safety_constraint"),
  caseDef("综合 CAN 总线配置与故障排查文档，终端电阻和发送队列应如何设置，队列过大有什么后果？", ["C016-F04", "C016-F05", "C017-F01", "C017-F04"], ["两个 120 欧姆", "txqueuelen 128", "过度峰值"], "multi_doc_synthesis"),
  caseDef("哪些机械或校准操作会让已有探针、床身或三角洲校准结果失效，需要重新测量？", ["C004-F04", "C005-F05", "C006-F02", "C006-F03"], ["探针校准失效", "重新测量", "探针校准的结果无效", "模型测量无效"], "multi_doc_synthesis"),
  caseDef("综合输入整形和共振测量文档，低频共振、2HUMP_EI、加速度计接口和 max_accel 应如何选择？", ["C011-F02", "C011-F05", "C012-F01", "C012-F03"], ["2HUMP_EI", "20-25 Hz", "I2C", "max_accel"], "multi_doc_synthesis"),
];

const abstainDefinitions = [
  abstainDef("这批 Klipper 资料是否提供树脂 SLA 打印机的曝光时间推荐表？", "当前资料只覆盖 Klipper 固件、配置、校准和相关接口，没有提供树脂 SLA 打印机的曝光时间推荐表，因此无法给出具体曝光参数。", ["没有提供", "SLA", "曝光时间"]),
  abstainDef("文档中列出的商业切片软件分别需要支付多少订阅费用？", "当前资料提到部分切片软件的配置方式，但未提供商业切片软件的订阅价格，无法据此回答具体费用。", ["未提供", "商业切片软件", "订阅价格"]),
  abstainDef("如何根据这批文档设置 FarmBot 的灌溉水压和浇水时长？", "这批资料是 Klipper 3D 打印机固件文档，没有包含 FarmBot 灌溉系统、水压或浇水时长信息，无法据此配置。", ["没有包含", "FarmBot", "灌溉"]),
  abstainDef("Klipper 文档给出的 Bambu Lab 云服务 API 密钥申请流程是什么？", "当前资料没有涉及 Bambu Lab 云服务或 API 密钥申请流程，无法从这批文档中确定。", ["没有涉及", "Bambu Lab", "API 密钥"]),
  abstainDef("这些资料规定的打印机整机保修期限和退换货政策是什么？", "这批资料不包含具体打印机品牌的保修期限或退换货政策，无法据此给出售后承诺。", ["不包含", "保修期限", "退换货政策"]),
];

const answerableCases = definitions.map((definition, index) => buildCase(definition, index + 1));
const abstainCases = abstainDefinitions.map((definition, index) => ({
  id: caseId(answerableCases.length + index + 1),
  question: definition.question,
  answerable: false,
  expectedAnswer: definition.expectedAnswer,
  expectedFacts: [],
  relevantSources: [],
  mustInclude: definition.mustInclude,
  evaluationType: "abstain",
}));

const output = {
  datasetId: compile.datasetId,
  name: "Klipper 3D 打印机中文手册评测集：Agent 检索回答评测 v2",
  sourceDir: "sources",
  cases: [...answerableCases, ...abstainCases],
};

assertDataset(output);
fs.writeFileSync(outputFile, `${JSON.stringify(output, null, 2)}\n`);
console.log(`generated ${output.cases.length} agent cases (${answerableCases.length} answerable, ${abstainCases.length} abstain)`);

function caseDef(question, factIds, mustInclude, evaluationType) {
  return { question, factIds, mustInclude, evaluationType };
}

function abstainDef(question, expectedAnswer, mustInclude) {
  return { question, expectedAnswer, mustInclude };
}

function caseId(index) {
  return `A${String(index).padStart(3, "0")}`;
}

function buildCase(definition, index) {
  const selectedFacts = definition.factIds.map((id) => {
    const fact = factById.get(id);
    if (!fact) throw new Error(`unknown compile fact: ${id}`);
    return fact;
  });
  const id = caseId(index);
  return {
    id,
    question: definition.question,
    answerable: true,
    expectedAnswer: selectedFacts.map((fact) => fact.fact).join("\n\n"),
    expectedFacts: selectedFacts.map((fact, factIndex) => ({
      id: `${id}-F${String(factIndex + 1).padStart(2, "0")}`,
      fact: fact.fact,
    })),
    relevantSources: [...new Set(selectedFacts.map((fact) => fact.sourceFile))],
    mustInclude: definition.mustInclude,
    evaluationType: definition.evaluationType,
  };
}

function assertDataset(dataset) {
  if (dataset.cases.length !== 50) throw new Error(`expected 50 cases, got ${dataset.cases.length}`);
  const ids = new Set();
  const questions = new Set();
  for (const testCase of dataset.cases) {
    if (ids.has(testCase.id)) throw new Error(`duplicate case id: ${testCase.id}`);
    if (questions.has(testCase.question)) throw new Error(`duplicate question: ${testCase.question}`);
    ids.add(testCase.id);
    questions.add(testCase.question);
    if (testCase.answerable) {
      if (testCase.expectedFacts.length < 2 || testCase.expectedFacts.length > 4) {
        throw new Error(`${testCase.id} expectedFacts must contain 2-4 facts`);
      }
      if (!testCase.relevantSources.length || testCase.relevantSources.length > 3) {
        throw new Error(`${testCase.id} relevantSources must contain 1-3 files`);
      }
      for (const fact of testCase.expectedFacts) {
        if (!testCase.expectedAnswer.includes(fact.fact)) {
          throw new Error(`${testCase.id} expectedAnswer does not contain ${fact.id}`);
        }
      }
    }
    for (const keyword of testCase.mustInclude) {
      if (!testCase.expectedAnswer.includes(keyword)) {
        throw new Error(`${testCase.id} expectedAnswer does not contain keyword: ${keyword}`);
      }
    }
  }
}
