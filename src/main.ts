import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { join } from "path";
import initDatabase from "./scripts/init-db";

async function bootstrap() {
  // Initialize database first
  await initDatabase();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter()
  );

  // Register fastify static
  await app.register(import("@fastify/static"), {
    root: join(__dirname, "..", "public"),
    prefix: "/public/",
  });

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle("Healthcare API")
    .setDescription("The Healthcare API description")
    .setVersion("1.0")
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  await app.listen(process.env.PORT || 3000, "0.0.0.0");
}
bootstrap();
