<?php

namespace App;

function greet(string $name): string
{
    return "Hello, $name!";
}

class Greeter
{
    public const DEFAULT_NAME = 'World';

    public function greet(string $name): string
    {
        return "Hi, $name!";
    }
}

interface Greeting
{
    public function hello(): string;
}

trait Loggable
{
    public function log(string $msg): void
    {
    }
}

enum Color: string
{
    case RED = 'red';
    case GREEN = 'green';

    public function label(): string
    {
        return ucfirst($this->value);
    }
}

const DEFAULT_GREETING = 'Hello';
