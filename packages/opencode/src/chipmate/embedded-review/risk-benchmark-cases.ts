import type { LogicCategory } from "./types"

type Seed = [id: string, defect: string, clean: string, language?: "c" | "cpp"]

export type LogicBenchmarkPair = {
  id: string
  language: "c" | "cpp"
  defect: string
  clean: string
  expected: { track: "LOGIC"; category: LogicCategory; severity: "P1"; line: number }
}

export const LOGIC_RISK_PAIRS: LogicBenchmarkPair[] = [
  ...make("CONTROL_CONTRACT", [
    [
      "zero-divisor-guard",
      "if (divisor != 0U) return -1; result = value / divisor;",
      "if (divisor == 0U) return -1; result = value / divisor;",
    ],
    ["success-error-swap", "if (device_start() != 0) return 0;", "if (device_start() != 0) return -1;"],
    ["milliseconds-as-ticks", "timer_arm(timeout_ms);", "timer_arm(ms_to_ticks(timeout_ms));"],
    ["frequency-scale", "clock_set_hz(freq_khz);", "clock_set_hz(freq_khz * 1000U);"],
    ["missing-endian-conversion", "header.length = wire_be16;", "header.length = ntohs(wire_be16);"],
    ["flag-mask-contract", "if ((flags & READY_MASK) == 1U) start();", "if ((flags & READY_MASK) != 0U) start();"],
    ["state-assignment-condition", "if (ctx->state = STATE_READY) run();", "if (ctx->state == STATE_READY) run();"],
    ["error-sign-contract", "return -driver_error();", "return driver_error();"],
    ["count-versus-bytes", "send_words(buf, byte_count);", "send_words(buf, byte_count / sizeof(uint32_t));"],
    ["phase-skip", "ctx->phase = PHASE_RUNNING;", "ctx->phase = PHASE_CONFIGURED;"],
    ["callback-result-inversion", "if (callback(ctx)) return ERROR;", "if (!callback(ctx)) return ERROR;"],
    ["api-argument-order", "dma_copy(dst, length, src);", "dma_copy(dst, src, length);"],
    ["bit-number-versus-mask", "register_set(IRQ_ENABLE_BIT);", "register_set(1U << IRQ_ENABLE_BIT);"],
    ["timeout-expiry-equality", "if (elapsed == timeout_ticks) expire();", "if (elapsed >= timeout_ticks) expire();"],
    ["enum-default-success", "default: return 0;", "default: return ERROR_UNSUPPORTED;"],
  ]),
  ...make("MEMORY_SECURITY", [
    ["memcpy-unbounded", "memcpy(dst, src, packet_len);", "memcpy(dst, src, min_size(packet_len, sizeof(dst)));"],
    ["strcpy-untrusted", "strcpy(name, input_name);", "copy_bounded(name, sizeof(name), input_name);"],
    ["use-after-free", "free(ctx); ctx->state = STATE_OFF;", "ctx->state = STATE_OFF; free(ctx);"],
    [
      "allocation-multiply-overflow",
      "buf = malloc(count * item_size);",
      "buf = alloc_array_checked(count, item_size);",
    ],
    [
      "negative-offset-cast",
      "read_bytes(buf + (size_t)offset, len);",
      "if (offset < 0) return ERROR; read_bytes(buf + (size_t)offset, len);",
    ],
    [
      "signed-array-index",
      "value = table[index];",
      "if (index < 0 || index >= TABLE_COUNT) return ERROR; value = table[index];",
    ],
    ["pointer-byte-offset", "word_ptr += byte_offset;", "word_ptr = (uint32_t *)((uint8_t *)word_ptr + byte_offset);"],
    ["wrong-struct-copy-size", "memcpy(dst, src, sizeof(dst));", "memcpy(dst, src, sizeof(*dst));"],
    ["snprintf-wrong-capacity", 'snprintf(buf, input_len, "%s", input);', 'snprintf(buf, sizeof(buf), "%s", input);'],
    ["overlap-memcpy", "memcpy(buf + 1, buf, len);", "memmove(buf + 1, buf, len);"],
    [
      "missing-string-terminator",
      "memcpy(name, input, sizeof(name));",
      "memcpy(name, input, sizeof(name) - 1U); name[sizeof(name) - 1U] = '\\0';",
    ],
    [
      "realloc-owner-loss",
      "buf = realloc(buf, next_size);",
      "tmp = realloc(buf, next_size); if (tmp == NULL) return ERROR; buf = tmp;",
    ],
    [
      "length-truncation",
      "uint16_t wire_len = payload_len;",
      "if (payload_len > UINT16_MAX) return ERROR; uint16_t wire_len = (uint16_t)payload_len;",
    ],
    [
      "header-length-before-check",
      "memcpy(dst, packet->data, packet->length);",
      "if (packet->length > sizeof(dst)) return ERROR; memcpy(dst, packet->data, packet->length);",
    ],
    ["flex-array-size", "msg = malloc(sizeof(message_t));", "msg = malloc(sizeof(message_t) + payload_len);"],
    ["allocation-element-size", "items = calloc(count, sizeof(items));", "items = calloc(count, sizeof(*items));"],
  ]),
  ...make("REALTIME_CONCURRENCY", [
    ["isr-sleep", "void timer_isr(void) { sleep_ms(10U); }", "void timer_isr(void) { schedule_timer_work(); }"],
    [
      "isr-mutex",
      "void uart_isr(void) { mutex_lock(&uart_lock); }",
      "void uart_isr(void) { if (!spin_trylock(&uart_lock)) return; }",
    ],
    [
      "irq-error-return",
      "irq_disable(); if (read_reg() == ERROR) return;",
      "irq_disable(); if (read_reg() == ERROR) { irq_enable(); return; }",
    ],
    ["non-atomic-ready-flag", "shared_ready++;", "atomic_fetch_add(&shared_ready, 1U);"],
    ["volatile-counter-race", "volatile_count = volatile_count + 1U;", "atomic_fetch_add(&shared_count, 1U);"],
    [
      "busy-loop-no-timeout",
      "while (!device_ready()) { poll(); }",
      "while (!device_ready() && timeout_left()) { poll(); }",
    ],
    [
      "delay-in-critical-section",
      "irq_disable(); delay_us(500U); irq_enable();",
      "irq_disable(); update_reg(); irq_enable(); delay_us(500U);",
    ],
    [
      "semaphore-wait-in-isr",
      "void adc_isr(void) { semaphore_wait(&done); }",
      "void adc_isr(void) { semaphore_post(&done); }",
    ],
    [
      "nested-irq-state",
      "irq_disable(); work(); irq_enable();",
      "irq_state = irq_save(); work(); irq_restore(irq_state);",
    ],
    [
      "missing-memory-barrier",
      "descriptor->ready = 1U; doorbell_write();",
      "descriptor->ready = 1U; memory_barrier(); doorbell_write();",
    ],
    [
      "check-then-act-race",
      "if (!busy) { busy = true; start_dma(); }",
      "if (atomic_compare_exchange(&busy, false, true)) start_dma();",
    ],
    [
      "blocking-lock-high-priority",
      "mutex_lock(&shared_lock); process_realtime();",
      "if (!mutex_trylock(&shared_lock)) defer_realtime_work();",
    ],
    [
      "recursive-interrupt-handler",
      "void gpio_isr(void) { gpio_isr(); }",
      "void gpio_isr(void) { handle_gpio_event(); }",
    ],
    [
      "flash-erase-in-isr",
      "void update_isr(void) { flash_erase(slot); }",
      "void update_isr(void) { schedule_flash_erase(slot); }",
    ],
    [
      "unbounded-queue-drain",
      "while (queue_pop(&item)) process(item);",
      "for (count = 0U; count < ISR_BUDGET && queue_pop(&item); count++) process(item);",
    ],
    [
      "tick-wrap-compare",
      "if (now_ticks > deadline_ticks) timeout();",
      "if ((int32_t)(now_ticks - deadline_ticks) > 0) timeout();",
    ],
    [
      "spinlock-error-leak",
      "spin_lock(&lock); if (failed()) return;",
      "spin_lock(&lock); if (failed()) { spin_unlock(&lock); return; }",
    ],
    [
      "callback-under-lock",
      "mutex_lock(&lock); callback(ctx); mutex_unlock(&lock);",
      "mutex_lock(&lock); snapshot(ctx); mutex_unlock(&lock); callback(ctx);",
    ],
    ["shared-bit-nonatomic", "shared_flags |= READY_MASK;", "atomic_fetch_or(&shared_flags, READY_MASK);"],
  ]),
  ...make("RESOURCE_LIFECYCLE", [
    [
      "file-close-error",
      "handle = device_open(); if (configure(handle) != 0) return ERROR;",
      "handle = device_open(); if (configure(handle) != 0) { device_close(handle); return ERROR; }",
    ],
    ["double-free-branch", "if (failed) free(buf); free(buf);", "if (failed) { free(buf); return; } free(buf);"],
    [
      "use-after-close",
      "device_close(handle); device_write(handle, data);",
      "device_write(handle, data); device_close(handle);",
    ],
    [
      "enable-failure-cleanup",
      "clock_enable(); if (device_enable() != 0) return ERROR;",
      "clock_enable(); if (device_enable() != 0) { clock_disable(); return ERROR; }",
    ],
    ["clock-stop-leak", "clock_enable(); sample_once();", "clock_enable(); sample_once(); clock_disable();"],
    [
      "reverse-init-cleanup",
      "bus_init(); sensor_init(); if (irq_init() != 0) return ERROR;",
      "bus_init(); sensor_init(); if (irq_init() != 0) { sensor_deinit(); bus_deinit(); return ERROR; }",
    ],
    [
      "handle-overwrite",
      "handle = device_open(); handle = device_open_backup();",
      "primary = device_open(); backup = device_open_backup();",
    ],
    [
      "transaction-no-rollback",
      "transaction_begin(); if (write_config() != 0) return ERROR;",
      "transaction_begin(); if (write_config() != 0) { transaction_rollback(); return ERROR; }",
    ],
    [
      "dma-map-leak",
      "map = dma_map(buf); if (dma_start(map) != 0) return ERROR;",
      "map = dma_map(buf); if (dma_start(map) != 0) { dma_unmap(map); return ERROR; }",
    ],
    [
      "irq-request-leak",
      "request_irq(); if (device_start() != 0) return ERROR;",
      "request_irq(); if (device_start() != 0) { free_irq(); return ERROR; }",
    ],
    ["worker-stop-leak", "worker_start(); device_stop();", "worker_start(); worker_stop(); device_stop();"],
    [
      "refcount-missing-put",
      "obj = object_get(); if (!obj->ready) return ERROR;",
      "obj = object_get(); if (!obj->ready) { object_put(obj); return ERROR; }",
    ],
    [
      "power-reference-leak",
      "power_get(); if (read_sensor() < 0) return ERROR;",
      "power_get(); if (read_sensor() < 0) { power_put(); return ERROR; }",
    ],
    ["buffer-ownership-conflict", "queue_submit(buf); free(buf);", "queue_submit_owned(buf);"],
    [
      "temporary-buffer-leak",
      "tmp = alloc(); if (validate(tmp) != 0) return ERROR;",
      "tmp = alloc(); if (validate(tmp) != 0) { free(tmp); return ERROR; }",
    ],
    [
      "retry-double-acquire",
      "for (retry = 0; retry < 3; retry++) handle = device_open();",
      "for (retry = 0; retry < 3 && handle == INVALID; retry++) handle = device_open();",
    ],
    [
      "cpp-raw-owner",
      "auto *buffer = new Buffer(); if (!buffer->init()) return;",
      "auto buffer = std::make_unique<Buffer>(); if (!buffer->init()) return;",
      "cpp",
    ],
    ["peripheral-disable-order", "power_disable(); peripheral_disable();", "peripheral_disable(); power_disable();"],
  ]),
  ...make("UPDATE_PERSISTENCE", [
    [
      "firmware-crc-ignored",
      "flash_write(slot, image, image_len); boot_set_slot(slot);",
      "if (!crc_valid(image, image_len)) return ERROR; flash_write(slot, image, image_len); boot_set_slot(slot);",
    ],
    [
      "activate-before-write",
      "boot_set_slot(slot); flash_write(slot, image, image_len);",
      "flash_write(slot, image, image_len); verify_slot(slot); boot_set_slot(slot);",
    ],
    [
      "downgrade-version",
      "if (image_version != current_version) install_image();",
      "if (image_version > current_version) install_image();",
    ],
    [
      "nvm-raw-struct-layout",
      "nvm_write(CONFIG_ADDR, &config, sizeof(config));",
      "serialize_config_v2(buffer, &config); nvm_write(CONFIG_ADDR, buffer, CONFIG_V2_SIZE);",
    ],
    [
      "erase-before-backup",
      "flash_erase(active_bank); copy_to_backup(active_bank);",
      "copy_to_backup(active_bank); verify_backup(); flash_erase(active_bank);",
    ],
    [
      "config-no-journal",
      "nvm_write(CONFIG_ADDR, &config, sizeof(config));",
      "journal_begin(); nvm_write(CONFIG_SHADOW, &config, sizeof(config)); journal_commit();",
    ],
    [
      "magic-only-validation",
      "if (header.magic == MAGIC) boot_image();",
      "if (header.magic == MAGIC && header.length <= SLOT_SIZE && crc_valid_image()) boot_image();",
    ],
    ["slot-selection-inversion", "if (slot_a.valid) boot_slot_b();", "if (slot_a.valid) boot_slot_a();"],
    [
      "rollback-counter-order",
      "rollback_counter_store(version); flash_write(slot, image, image_len);",
      "flash_write(slot, image, image_len); verify_slot(slot); rollback_counter_store(version);",
    ],
    [
      "schema-without-migration",
      "config.schema = SCHEMA_V3; nvm_write_config(&config);",
      "migrate_config(&config, config.schema, SCHEMA_V3); nvm_write_config(&config);",
    ],
    [
      "persistent-endian-host",
      "record.version = version; nvm_write_record(&record);",
      "record.version_le = cpu_to_le32(version); nvm_write_record(&record);",
    ],
    [
      "checksum-wrong-length",
      "record.crc = crc32(&record, sizeof(record));",
      "record.crc = crc32(&record, offsetof(record_t, crc));",
    ],
    [
      "dual-copy-no-generation",
      "nvm_write(COPY_A, &config, sizeof(config));",
      "config.generation++; nvm_write(COPY_B, &config, sizeof(config)); verify_copy(COPY_B);",
    ],
    [
      "boot-flag-cleared-early",
      "boot_clear_pending(); if (!self_test()) rollback();",
      "if (!self_test()) rollback(); boot_clear_pending();",
    ],
    [
      "signature-not-verified",
      "if (crc_valid(image, image_len)) install_firmware();",
      "if (crc_valid(image, image_len) && signature_valid(image, image_len)) install_firmware();",
    ],
    [
      "abi-size-assumption",
      "if (header.size == sizeof(image_header_t)) accept_image();",
      "if (header.abi_version == ABI_V2 && header.size == IMAGE_HEADER_V2_SIZE) accept_image();",
    ],
    [
      "generation-wrap",
      "if (copy_a.generation > copy_b.generation) use_a();",
      "if ((int32_t)(copy_a.generation - copy_b.generation) > 0) use_a();",
    ],
    [
      "flash-write-unaligned",
      "flash_write(address, data, length);",
      "if (!flash_aligned(address, length)) return ERROR; flash_write(address, data, length);",
    ],
    [
      "nvm-wear-hot-loop",
      "while (running) nvm_write_status(status);",
      "if (status != stored_status) nvm_write_status(status);",
    ],
    [
      "invalid-recovery-fallback",
      "if (!config_a.valid) load_config_b();",
      "if (!config_a.valid && config_b.valid) load_config_b(); else if (!config_a.valid) load_factory_config();",
    ],
  ]),
]

function make(category: LogicCategory, seeds: Seed[]): LogicBenchmarkPair[] {
  return seeds.map((seed) => ({
    id: seed[0],
    language: seed[3] ?? "c",
    defect: source(seed[1]),
    clean: source(seed[2]),
    expected: { track: "LOGIC", category, severity: "P1", line: 3 },
  }))
}

function source(body: string) {
  return ["void review_case(void)", "{", ...body.split("\n").map((line) => `    ${line}`), "}", ""].join("\n")
}
