#ifndef CSPICE_MATH_H
#define CSPICE_MATH_H

#include <stdbool.h>

#define MAX_COMPARISON_SITES 8
#define HORIZON_BINS 360
#define MAX_SIMULATION_STEPS 20000

typedef struct {
    int step_index;
    char utc[32];
    double et_seconds;
    double sun_azimuth_deg;
    double sun_elevation_deg;
    double earth_azimuth_deg;
    double earth_elevation_deg;
    double sun_terrain_horizon_deg;
    double earth_terrain_horizon_deg;
    bool is_sun_visible;
    bool is_earth_visible;
} TimeSample;

typedef struct {
    char start_utc[32];
    char end_utc[32];
    double duration_hours;
} VisibilityWindow;

typedef struct {
    char site_name[64];
    double latitude_deg;
    double longitude_deg;
    double altitude_m;

    double total_sun_hours;
    double illumination_percent;
    double longest_sun_hours;

    double total_earth_hours;
    double earth_visibility_percent;
    double longest_earth_hours;
    int dte_window_count;

    double overlap_hours;
    double longest_dark_hours;

    double avg_sun_elevation_deg;
    double avg_earth_elevation_deg;
    int mission_score;
} SiteSummary;

typedef struct {
    int status;
    char error_msg[256];
    bool using_real_dem;
    bool dem_out_of_bounds;
    char warning_msg[256];

    SiteSummary summary;
    double terrain_horizon_mask[HORIZON_BINS];

    int total_steps;
    int step_seconds;
    TimeSample *samples;

    int sun_window_count;
    VisibilityWindow *sun_windows;

    int earth_window_count;
    VisibilityWindow *earth_windows;

    int comparison_count;
    SiteSummary comparisons[MAX_COMPARISON_SITES];
} SimulationResult;

int init_spice_engine(const char *custom_kernel_dir);

SimulationResult run_lunar_simulation(
    const char *site_name,
    double lat_deg,
    double lon_deg,
    double altitude_m,
    bool use_custom_coords,
    const char *start_utc,
    const char *end_utc,
    int step_seconds,
    bool use_dem_horizon,
    double min_sun_el_deg,
    double min_earth_el_deg,
    bool include_earth_disk
);

void free_simulation_result(SimulationResult *res);

#endif // CSPICE_MATH_H