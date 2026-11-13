CC ?= gcc
CFLAGS = -O2 -Wall -Wextra -I./cspice/include
UNAME_S := $(shell uname -s)

ifeq ($(UNAME_S),Darwin)
    LUA_FLAGS := $(shell pkg-config --cflags --libs lua 2>/dev/null || echo "-I/opt/homebrew/include/lua -L/opt/homebrew/lib -llua")
else
    LUA_FLAGS := $(shell pkg-config --cflags --libs lua5.4 2>/dev/null || echo "-I/usr/include/lua5.4 -llua5.4")
endif

TARGET = MissionPlanner
SRCS = src/main.c src/cspice_math.c
SPICE_LIB = ./cspice/lib/cspice.a

all: $(TARGET)

$(TARGET): $(SRCS) src/cspice_math.h
	$(CC) $(CFLAGS) $(SRCS) $(SPICE_LIB) $(LUA_FLAGS) -lm -o $(TARGET)

run: $(TARGET)
	./$(TARGET)

once: $(TARGET)
	./$(TARGET) --once

test:
	lua5.4 debug_pipeline.lua

clean:
	rm -f $(TARGET) cspice_test *.o

.PHONY: all run once test clean