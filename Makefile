CC      ?= gcc
CFLAGS  ?= -O2 -std=c11 -Wall -Wextra -Wpedantic -Isrc
LDFLAGS ?= -lm

ifneq ($(wildcard cspice/include/SpiceUsr.h),)
  CFLAGS  += -Icspice/include
  LDFLAGS := cspice/lib/cspice.a $(LDFLAGS)
endif

LUA_CFLAGS := $(shell pkg-config --cflags lua5.4 2>/dev/null || pkg-config --cflags lua 2>/dev/null)
LUA_LIBS   := $(shell pkg-config --libs lua5.4 2>/dev/null || pkg-config --libs lua 2>/dev/null)
ifneq ($(LUA_LIBS),)
  CFLAGS  += $(LUA_CFLAGS)
  LDFLAGS += $(LUA_LIBS)
endif

BUILD_DIR := build
TARGET    := $(BUILD_DIR)/lunar_sim
ALIAS     := MissionPlanner

CORE_SRCS := src/cspice_math.c src/3b_moon.c
APP_SRCS  := src/main.c $(CORE_SRCS)
HEADERS   := src/cspice_math.h src/3b_moon.h

.PHONY: all clean test serve asan pipeline

all: $(TARGET) $(ALIAS)

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(TARGET): $(APP_SRCS) $(HEADERS) | $(BUILD_DIR)
	$(CC) $(CFLAGS) $(APP_SRCS) -o $(TARGET) $(LDFLAGS)

$(ALIAS): $(TARGET)
	ln -sf $(TARGET) $(ALIAS)

test: $(TARGET)
	./$(TARGET) --once

serve: $(TARGET)
	./$(TARGET) --serve 8080

pipeline: $(TARGET)
	lua5.4 debug_pipeline.lua

asan: | $(BUILD_DIR)
	$(CC) -O1 -g -std=c11 -Wall -Wextra -fsanitize=address,undefined -fno-omit-frame-pointer -Isrc $(APP_SRCS) -o $(BUILD_DIR)/lunar_sim_asan $(LDFLAGS)
	./$(BUILD_DIR)/lunar_sim_asan --once

clean:
	rm -rf $(BUILD_DIR) $(ALIAS)
