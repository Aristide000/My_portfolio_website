import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { routes } from './app/app.routes';
import { RootComponent } from './app/root.component';

bootstrapApplication(RootComponent, {
  providers: [
    provideRouter(routes),
    provideZoneChangeDetection({
      eventCoalescing: true,
      runCoalescing: true
    })
  ]
});
