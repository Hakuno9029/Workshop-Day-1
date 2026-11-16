import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, ValidatorFn, Validators } from '@angular/forms';
import { finalize, Subscription } from 'rxjs';
import { Link, LinksService } from './links.service';

const httpUrl: ValidatorFn = (control) => {
  const value: string = control.value;
  if (!value) return null;
  if (/[\x00-\x1f\x7f]/.test(value)) return { httpUrl: true };
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? null : { httpUrl: true };
  } catch {
    return { httpUrl: true };
  }
};

@Component({
  selector: 'app-root',
  imports: [ReactiveFormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  private readonly api = inject(LinksService);
  private readonly destroyRef = inject(DestroyRef);
  private listRequest?: Subscription;

  readonly form = new FormGroup({
    url: new FormControl('', { nonNullable: true, validators: [Validators.required, httpUrl] })
  });
  readonly links = signal<Link[]>([]);
  readonly loading = signal(false);
  readonly pending = signal(false);
  readonly listError = signal('');
  readonly submitError = signal('');
  readonly createdLink = signal<Link | null>(null);

  constructor() {
    this.form.controls.url.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.submitError.set('');
    });
  }

  ngOnInit() {
    this.loadLinks();
  }

  get urlError(): string {
    if (this.submitError()) return this.submitError();
    const field = this.form.controls.url;
    if (!field.touched || field.valid) return '';
    return field.hasError('required') ? 'Enter a URL.' : 'Enter a complete http:// or https:// URL.';
  }

  loadLinks() {
    this.listRequest?.unsubscribe();
    this.loading.set(true);
    this.listError.set('');
    this.listRequest = this.api.list().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.loading.set(false))
    ).subscribe({
      next: (links) => this.links.set(links),
      error: (error: unknown) => this.listError.set(this.errorMessage(error, 'Could not load links. Please retry.'))
    });
  }

  submit() {
    if (this.pending()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    this.pending.set(true);
    this.submitError.set('');
    this.createdLink.set(null);
    this.api.create(this.form.controls.url.value.trim()).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.pending.set(false))
    ).subscribe({
      next: (link) => {
        this.form.reset();
        this.createdLink.set(link);
        this.loadLinks();
      },
      error: (error: unknown) => this.submitError.set(this.errorMessage(error, 'Could not shorten this URL. Please retry.'))
    });
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) return 'Cannot reach the server. Check your connection and retry.';
      const body: unknown = error.error;
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        return body.error || fallback;
      }
    }
    return fallback;
  }
}
